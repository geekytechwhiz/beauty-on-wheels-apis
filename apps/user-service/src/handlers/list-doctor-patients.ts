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
import { listDoctorPatientsSchema, listDoctorPatientsQuerySchema } from '../validation/user.validation';
import { UserNotFoundError } from '../utils/errors';
import { PATH_DOCTOR_PATIENT_LIST } from '../utils/constants';

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
  logger.info({ event: 'listDoctorPatients_received', method: event.httpMethod });

  const httpMethod = event.httpMethod?.toUpperCase() || 'POST';
  const isGet = httpMethod === 'GET';

  // Parse input: GET uses query params, POST uses body
  let input: unknown;
  if (isGet) {
    const queryParams = event.queryStringParameters || {};
    input = {
      organizationId: queryParams.organizationId,
      doctorId: queryParams.doctorId,
      showConsultations: queryParams.showConsultations,
    };
  } else {
    try {
      input = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (err) {
      logger.error({
        event: 'listDoctorPatients_parse_error',
        err: serializeError(err as Error),
      });
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        httpMethod,
        PATH_DOCTOR_PATIENT_LIST,
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.INVALID_JSON',
        { requestId: correlationId, event },
        {
          code: 'BAD_REQUEST',
          details: [{ message: 'Invalid JSON body' }],
        },
      );
    }
  }

  // Validate input based on method
  const validation = isGet
    ? listDoctorPatientsQuerySchema.safeParse(input)
    : listDoctorPatientsSchema.safeParse(input);

  if (!validation.success) {
    logger.warn({
      event: 'listDoctorPatients_validation_error',
      errors: validation.error.issues,
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      httpMethod,
      PATH_DOCTOR_PATIENT_LIST,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.map(String).join('.'),
          message: e.message,
        })),
      },
    );
  }

  const { organizationId, doctorId, showConsultations = false } = validation.data;

  try {
    let users: Record<string, unknown>[];

    if (doctorId) {
      // Doctor-specific view: get patients assigned to this doctor
      logger.info({ event: 'listDoctorPatients_doctor_view', doctorId, organizationId });
      const doctorPatients = await userService.listDoctorPatients(
        doctorId,
        organizationId,
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
      logger.info({ event: 'listDoctorPatients_organization_view', organizationId });
      const orgUsers = await userService.listOrganizationUsers(organizationId, {
        userType: 'USER',
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
          patientOrgId: user.organizationID || organizationId,
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
    return ApiResponse.ok(
      { users },
      'USER.LIST_DOCTOR_PATIENTS_SUCCESS',
      { requestId: correlationId, event },
    );
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
        details: [
          { message: (err as Error)?.message || 'Unknown error' },
        ],
      },
    );
  }
}

export const main: APIGatewayProxyHandler = async (
  event,
  context: Context,
) => {
  return listDoctorPatients(event, context);
};

