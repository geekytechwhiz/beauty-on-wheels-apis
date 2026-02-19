import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
  APIGatewayProxyHandler,
} from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { listDoctorPatientsQuerySchema } from '../validation/user.validation';
import { UserNotFoundError } from '../utils/errors';
import { PATH_DOCTOR_PATIENT_LIST } from '../utils/constants';
import {
  mapAllPatientResponse,
  mapLabPatientResponse,
  mapAssignedPatientResponse,
  mapDoctorPatientResponse,
} from '../utils/helpers';
import { FilterType } from '../types/feature-types';
import { scheduleServiceClient } from '../clients/scheduleService.client';
import { packageServiceClient } from '../clients/packageService.client';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();
type RequestBody = {
  filter: FilterType;
  showConsultations?: boolean;
  showActiveAppointment?: boolean;
  organizationID: string;
  userID?: string;
};
export async function listDoctorPatients(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  const body: RequestBody = event.body ? JSON.parse(event.body) as RequestBody : {
    filter: 'staff',
    showConsultations: false,
    showActiveAppointment: false,
    organizationID: '',
    userID: '',
  };
  const { filter, showConsultations = false, showActiveAppointment = false, organizationID, userID } = body;

   
  // staff, all-patient, assigned-patient, lab-patient
  logger.info({
    event: 'listDoctorPatients_start',
    filter: filter,
    showConsultations,
    organizationID,
    userID,
  });
  const validation = listDoctorPatientsQuerySchema.safeParse({
    filter: filter,
    organizationID,
    userID,
    showActiveAppointment,
  });

  if (!validation.success) {
    logger.warn({
      event: 'listDoctorPatients_validation_error',
      errors: validation.error.issues,
    });
    return ApiResponse.badRequest(
      'USER.LIST_DOCTOR_PATIENTS_FAILED',
      { requestId: correlationId, event },
      {
        code: 'LIST_DOCTOR_PATIENTS_FAILED',
        details: [{ message: validation.error.issues[0].message }],
      },
    );
  }
  try {
    switch (filter) {
      case 'assigned-patient':
        logger.info({
          event: 'listDoctorPatients_branch',
          filter: 'assigned-patient',
          organizationID,
          userID,
        });
        const assignedPatients = await userService.listDoctorPatients(
          userID || '',
          organizationID || '',
        );
        const mappedAssignedPatients = mapAssignedPatientResponse(assignedPatients);
        return ApiResponse.ok(mappedAssignedPatients, 'USER.LIST_DOCTOR_PATIENTS_SUCCESS', {
          requestId: correlationId,
          event,
        });
      case 'all-patient':
        logger.info({
          event: 'listDoctorPatients_branch',
          filter: 'all-patient',
          organizationID,
          showConsultations,
          showActiveAppointment,
        });
        
        // Handle showActiveAppointment: fetch only patients with active appointments
        if (showActiveAppointment && !userID) {
          if (!scheduleServiceClient) {
            logger.warn({
              event: 'listDoctorPatients_showActiveAppointment_no_client',
              message: 'SCHEDULE_SERVICE_API_URL not configured',
            });
            return ApiResponse.internalServerError(
              'USER.LIST_DOCTOR_PATIENTS_FAILED',
              { requestId: correlationId, event },
              {
                code: 'LIST_DOCTOR_PATIENTS_FAILED',
                details: [{ message: 'Schedule service not configured' }],
              },
            );
          }

          const authHeader = event.headers?.Authorization || event.headers?.authorization;
          
          try {
            // Fetch latest active appointments
            const appointmentInfo = await scheduleServiceClient.getLatestActiveAppointments(
              organizationID,
              authHeader,
            );
            
            logger.info({
              event: 'listDoctorPatients_appointments_fetched',
              count: appointmentInfo.length,
            });

            if (!appointmentInfo || appointmentInfo.length === 0) {
              return ApiResponse.ok([], 'USER.LIST_DOCTOR_PATIENTS_SUCCESS', {
                requestId: correlationId,
                event,
              });
            }

            // Fetch user services for appointments
            let userServices: any[] = [];
            if (packageServiceClient) {
              try {
                const serviceRequests = appointmentInfo.map((appt) => {
                  const req: any = { userId: appt.userId };
                  if (appt.userAddonId) req.userAddonId = appt.userAddonId;
                  else if (appt.userPackageId) req.userPackageId = appt.userPackageId;
                  return req;
                });
                
                userServices = await packageServiceClient.getServicesByList(serviceRequests, authHeader);
                
                // Map schedule metadata to services
                const scheduleMetaMap = new Map<string, Record<string, unknown>>();
                appointmentInfo.forEach((appt) => {
                  if (appt.scheduleId && appt.meta) {
                    scheduleMetaMap.set(appt.scheduleId, appt.meta);
                  }
                });
                
                userServices.forEach((service) => {
                  if (Array.isArray(service.scheduled)) {
                    service.scheduled.forEach((schedule: any) => {
                      if (schedule.scheduleId && scheduleMetaMap.has(schedule.scheduleId)) {
                        schedule.meta = scheduleMetaMap.get(schedule.scheduleId);
                      }
                    });
                  }
                });
              } catch (serviceErr) {
                logger.warn({
                  event: 'listDoctorPatients_services_fetch_warning',
                  err: serializeError(serviceErr as Error),
                  message: 'Failed to fetch user services, continuing without activeService',
                });
              }
            }

            // Create map of userId -> activeService
            const activeServiceMap = new Map<string, any>();
            appointmentInfo.forEach((appt) => {
              const matchingService = userServices.find((service) => {
                return (
                  (appt.userAddonId && service.userAddonId === appt.userAddonId) ||
                  (appt.userPackageId && service.userPackageId === appt.userPackageId)
                );
              });
              if (matchingService) {
                activeServiceMap.set(appt.userId, matchingService);
              }
            });

            // Fetch user data for each appointment
            const patientList = await Promise.all(
              appointmentInfo.map(async (appt) => {
                try {
                  const user = await userService.getUser(appt.userId, appt.patientOrgId || organizationID);
                  return user;
                } catch (err) {
                  logger.warn({
                    event: 'listDoctorPatients_user_fetch_warning',
                    userId: appt.userId,
                    err: serializeError(err as Error),
                  });
                  return null;
                }
              }),
            );

            // Filter out nulls and map to response format
            const validPatients = patientList.filter((p) => p !== null) as any[];
            const mappedPatientList = mapAllPatientResponse(validPatients, activeServiceMap);
            
            return ApiResponse.ok(mappedPatientList, 'USER.LIST_DOCTOR_PATIENTS_SUCCESS', {
              requestId: correlationId,
              event,
            });
          } catch (appointmentErr) {
            logger.error({
              event: 'listDoctorPatients_appointments_error',
              err: serializeError(appointmentErr as Error),
            });
            return ApiResponse.internalServerError(
              'USER.LIST_DOCTOR_PATIENTS_FAILED',
              { requestId: correlationId, event },
              {
                code: 'LIST_DOCTOR_PATIENTS_FAILED',
                details: [{ message: (appointmentErr as Error)?.message || 'Failed to fetch appointments' }],
              },
            );
          }
        }

        // Normal all-patient flow (without showActiveAppointment)
        const patientList = await userService.listOrganizationUsers(
          organizationID || '',
          {
            filter: filter?.toUpperCase(),
            previouslyConsulted: showConsultations ? true : false,
          },
        );
        const mappedPatientList = mapAllPatientResponse(patientList);
        return ApiResponse.ok(mappedPatientList, 'USER.LIST_DOCTOR_PATIENTS_SUCCESS', {
          requestId: correlationId,
          event,
        });
      case 'lab-patient':
        logger.info({
          event: 'listDoctorPatients_branch',
          filter: 'lab-patient',
          organizationID,
          showConsultations,
        });
        const labPatientList = await userService.listOrganizationUsers(
          organizationID || '',
          {
            filter: filter?.toUpperCase(),
            previouslyConsulted: showConsultations ? true : false,
          },
        );
        const mappedLabPatientList = mapLabPatientResponse(labPatientList);
        return ApiResponse.ok(mappedLabPatientList, 'USER.LIST_LAB_PATIENTS_SUCCESS', {
          requestId: correlationId,
          event,
        });
      case 'staff':
      case 'all':
        logger.info({
          event: 'listDoctorPatients_branch',
          filter,
          organizationID,
          showConsultations,
        });
        const staffList = await userService.listOrganizationUsers(
          organizationID || '',
          {
            filter: filter?.toUpperCase(),
            previouslyConsulted: showConsultations ? true : false,
          },
        );
        // Map to DoctorPatientResponse format with all required fields
        const mappedDoctorStaffList = mapDoctorPatientResponse(staffList);
        return ApiResponse.ok(mappedDoctorStaffList, 'USER.LIST_STAFF_SUCCESS', {
          requestId: correlationId,
          event,
        });
      default:
        logger.warn({
          event: 'listDoctorPatients_branch',
          filter,
          message: 'unhandled filter, falling through',
        });
        return ApiResponse.badRequest(
          'USER.LIST_DOCTOR_PATIENTS_FAILED',
          { requestId: correlationId, event },
          {
            code: 'LIST_DOCTOR_PATIENTS_FAILED',
            details: [{ message: `Invalid filter: ${filter}` }],
          },
        );
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod?.toUpperCase() || 'POST',
        PATH_DOCTOR_PATIENT_LIST,
        404,
        duration,
        correlationId,
      );
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        {
          code: 'USER_NOT_FOUND',
          details: [{ message: err.message }],
        },
      );
    }
    logger.error({
      event: 'listDoctorPatients_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod?.toUpperCase() || 'POST',
      PATH_DOCTOR_PATIENT_LIST,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.LIST_DOCTOR_PATIENTS_FAILED',
      { requestId: correlationId, event },
      {
        code: 'LIST_DOCTOR_PATIENTS_FAILED',
        details: [{ message: (err as Error)?.message || 'Unknown error' }],
      },
    );
  }
}

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listDoctorPatients(event, context);
};
