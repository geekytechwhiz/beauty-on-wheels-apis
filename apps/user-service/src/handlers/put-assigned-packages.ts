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
import { UserNotFoundError } from '../utils/errors';
import { assignedPackagesSchema } from '../validation/user.validation';
import { PATH_ASSIGNED_PACKAGES } from '../utils/constants';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function putAssignedPackages(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;
  const organizationId = event.pathParameters?.organizationId;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId,
    organizationId,
    ...(awsRequestId && { awsRequestId }),
  });

  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_ASSIGNED_PACKAGES,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [
          { message: 'userId and organizationId are required in path' },
        ],
      },
    );
  }

  let body: unknown;
  try {
    body =
      typeof event.body === 'string'
        ? JSON.parse(event.body || '{}')
        : event.body ?? {};
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_ASSIGNED_PACKAGES,
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

  const validation = assignedPackagesSchema.safeParse(body);
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_ASSIGNED_PACKAGES,
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
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  const { assignedPackages, assignedPackagesName } = validation.data;

  try {
    await userService.updateUser(
      userId,
      organizationId,
      { assignedPackages, assignedPackagesName },
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_ASSIGNED_PACKAGES,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      { success: true },
      'USER.ASSIGNED_PACKAGES_UPDATED',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        PATH_ASSIGNED_PACKAGES,
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
      event: 'putAssignedPackages_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_ASSIGNED_PACKAGES,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.ASSIGNED_PACKAGES_UPDATE_FAILED',
      { requestId: correlationId, event },
      {
        code: 'ASSIGNED_PACKAGES_UPDATE_FAILED',
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
  return putAssignedPackages(event, context);
};

