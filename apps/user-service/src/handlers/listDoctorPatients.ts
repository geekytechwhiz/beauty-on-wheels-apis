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
  mapPatientResponse,
  mapLabPatientResponse,
  mapAssignedPatientResponse,
  mapStaffResponse,
} from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();
type Filter = "staff" | "all-patient" | "assigned-patient" | "lab-patient" | "all";
type RequestBody = {
  filter: Filter;
  showConsultations: boolean;
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
  const {filter: filter, showConsultations, organizationID, userID}:RequestBody = event.body ? JSON.parse(event.body) as RequestBody : {
    filter: 'staff',
    showConsultations: false,
    organizationID: '',
    userID: '',
  };

   
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
        });
        const patientList = await userService.listOrganizationUsers(
          organizationID || '',
          {
            filter: filter?.toUpperCase(),
            previouslyConsulted: showConsultations ? true : false,
          },
        );
        const mappedPatientList = mapPatientResponse(patientList);
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
        // Map to StaffResponse format with all required fields
        const mappedStaffList = mapStaffResponse(staffList);
        return ApiResponse.ok(mappedStaffList, 'USER.LIST_STAFF_SUCCESS', {
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
