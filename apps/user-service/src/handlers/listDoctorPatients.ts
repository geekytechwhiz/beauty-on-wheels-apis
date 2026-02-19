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
import { 
  listDoctorPatientsQuerySchema,
} from '../validation/user.validation';
import { UserNotFoundError } from '../utils/errors';
import { PATH_DOCTOR_PATIENT_LIST } from '../utils/constants';
import {
  getAuthorizerOrganizationId,
  getAuthorizerUserId,
} from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

/**
 * List patients assigned to a doctor or all patients in organization (front desk view).
 * Supports both GET (query params) and POST (body) for backward compatibility.
 *
 * Query parameters (GET):
 * - organizationId: required
 * - doctorId: optional, if provided returns doctor's patients; if omitted returns all patients in org
 * - showConsultations: optional boolean, if true includes previouslyConsulted field
 *
 * Body (POST - legacy):
 * - organizationId: required
 * - doctorId: optional
 * - showConsultations: optional boolean
 */
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
  const userType =  event.queryStringParameters?.userType || ''
  const showConsultations =  event.queryStringParameters?.showConsultations || false;
  const validation = listDoctorPatientsQuerySchema.safeParse(userType);

  if (!validation.success) {
    logger.warn({
      event: 'listDoctorPatients_validation_error',
      errors: validation.error.issues,
    });
  }
    logger.info({
      event: 'listDoctorPatients_received',
      method: event.httpMethod,
    });
    const organizationID = getAuthorizerOrganizationId(event);
    const userID = getAuthorizerUserId(event);

    logger.info({
      event: 'listDoctorPatients_organization_check',
      organizationID: organizationID,
      userID: userID,
    });
    const httpMethod = event.httpMethod?.toUpperCase() || 'POST';
 
 
  try {
    let users: Record<string, unknown>[];

    if (userType?.toLowerCase() === 'doctor') {
      // Doctor-specific view: get patients assigned to this doctor
      logger.info({
        event: 'listDoctorPatients_doctor_view',
        userID: userID, 
      });
      const doctorPatients = await userService.listDoctorPatients(
        userID || '', 
        organizationID || '',
      );

      // Conditionally include previouslyConsulted field based on showConsultations flag
      users = doctorPatients.map((patient) => {
        const result = { ...patient };
        if (!showConsultations && 'previouslyConsulted' in result) {
          delete result.previouslyConsulted;
        }
        return result;
      });
    } else {
      // Organization-level view (front desk): get all patients in organization
      logger.info({
        event: 'listDoctorPatients_organization_view',
        organizationId: organizationID,
      });
      const orgUsers = await userService.listOrganizationUsers(organizationID || '', {
        userType: userType.toUpperCase(),
      });

      // Transform to match expected format
      users = orgUsers.map((user) => {
        const u = user as any;
        return {
          city: user.city || '',
          state: u.state || '',
          country: u.country || '',
          fullName: user.fullName || '',
          emailAddress: user.emailAddress || '',
          phoneNumber: user.phoneNumber || '',
          lastAppointment: u.lastAppointment ?? null,
          profilePic: user.profilePic || '',
          reporterId: u.reporterId || '',
          doctor: u.reporterName || '',
          patientId: user.userID,
          userID: user.userID,
          accountType: u.isRpmUser ? 'RPM' : 'REGULAR',
          status: u.isActive !== false ? 'active' : 'inactive',
          createdDate: user.createdDate ?? null,
          mrn: u.mrn ?? null,
          gender: u.gender || '',
          medicalHistory: u.medicalHistory ?? null,
          dateOfBirth: u.dateOfBirth ?? null,
          patientOrgId: user.organizationID || organizationID,
        };
      });
    }

    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      httpMethod,
      PATH_DOCTOR_PATIENT_LIST,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok({ users }, 'USER.LIST_DOCTOR_PATIENTS_SUCCESS', {
      requestId: correlationId,
      event,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        httpMethod,
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
      httpMethod,
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
