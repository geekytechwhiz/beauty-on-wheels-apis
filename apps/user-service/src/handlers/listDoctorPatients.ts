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
  getAuthorizerOrganizationId,
  getAuthorizerUserId,
  mapUserResponse,
} from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

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
  const userType = event.pathParameters?.userType;
  const showConsultations =
    event.queryStringParameters?.showConsultations || false;
  const organizationID = getAuthorizerOrganizationId(event);
  const userID = getAuthorizerUserId(event);

  const validation = listDoctorPatientsQuerySchema.safeParse({
    userType,
    organizationID,
    userID,
  });

  if (!validation.success) {
    logger.warn({
      event: 'listDoctorPatients_validation_error',
      errors: validation.error.issues,
    });
  }
  let users: Record<string, unknown>[];
  try {
    switch (userType) {
      case 'doctor':
        users = await userService.listDoctorPatients(
          userID || '',
          organizationID || '',
        );
        return ApiResponse.ok(users, 'USER.LIST_DOCTOR_PATIENTS_SUCCESS', {
          requestId: correlationId,
          event,
        });
      default:
        const response = await userService.listOrganizationUsers(
          organizationID || '',
          {
            userType: userType?.toUpperCase(),
            previouslyConsulted: showConsultations ? true : false,
          },
        );
        const mappedresponse = mapUserResponse(response);
        return ApiResponse.ok(mappedresponse, 'USER.LIST_USERS_SUCCESS', {
          requestId: correlationId,
          event,
        });
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
