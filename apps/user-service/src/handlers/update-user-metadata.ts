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
import { updateUserMetadataSchema } from '../validation/user.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function updateUserMetadata(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || `/users/${userId}/metadata`,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'userId is required' }],
      },
    );
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'updateUserMetadata_received', eventData: event });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({
      event: 'updateUserMetadata_parse_error',
      err: serializeError(err as Error),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || `/users/${userId}/metadata`,
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

  const validation = updateUserMetadataSchema.safeParse({
    ...(body as Record<string, unknown>),
    userId,
  });
  if (!validation.success) {
    logger.warn({
      event: 'updateUserMetadata_validation_error',
      errors: validation.error.issues,
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || `/users/${userId}/metadata`,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const result = await userService.updateUserMetadata(
      userId,
      validation.data.metadata,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || `/users/${userId}/metadata`,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      result,
      'USER.METADATA_UPDATED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        event.path || `/users/${userId}/metadata`,
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
      event: 'updateUserMetadata_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || `/users/${userId}/metadata`,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.UPDATE_METADATA_FAILED',
      { requestId: correlationId, event },
      {
        code: 'UPDATE_USER_METADATA_FAILED',
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
  return updateUserMetadata(event, context);
};

