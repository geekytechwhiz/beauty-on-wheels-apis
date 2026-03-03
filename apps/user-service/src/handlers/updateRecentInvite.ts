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
import { UserNotFoundError, InviteUpdateTooSoonError } from '../utils/errors';
import { getAuthorizerUserId, getAuthorizerOrganizationId } from '../utils/helpers';
import { updateRecentInviteSchema } from '../validation/user.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

async function updateRecentInvite(
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

  const requestUserId = getAuthorizerUserId(event);
  const requestOrgId = getAuthorizerOrganizationId(event);

  let body: any;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({
      event: 'updateRecentInvite_parse_error',
      err: serializeError(err as Error),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/updateRecentInvite',
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

  // Validate request body
  const validation = updateRecentInviteSchema.safeParse(body);
  if (!validation.success) {
    const errors = validation.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/updateRecentInvite',
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: errors,
      },
    );
  }

  // Get userId and organizationId from body or authorizer
  let userId = validation.data.userId  
  let organizationId = validation.data.organizationId  
  let patientId = validation.data.patientId;

  if (!userId || !organizationId || !patientId) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/updateRecentInvite',
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.MISSING_REQUIRED_FIELDS',
      { requestId: correlationId, event },
      {
        code: 'MISSING_REQUIRED_FIELDS',
        details: [
          {
            message: userId
              ? 'organizationId is required'
              : organizationId
                ? 'userId is required'
                : 'userId and organizationId are required',
          },
        ],
      },
    );
  }

  // At least one of email or sms must be provided
  if (validation.data.email === undefined && validation.data.sms === undefined) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/updateRecentInvite',
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: [
          {
            message: 'At least one of email or sms must be provided',
          },
        ],
      },
    );
  }

  try {
    logger.info({
      event: 'updateRecentInvite_start',
      userId,
      organizationId,
      patientId,
      email: validation.data.email,
      sms: validation.data.sms,
    });

    const result = await userService.updateRecentInvite(
      userId,
      organizationId,
      patientId,
      {
        email: validation.data.email,
        sms: validation.data.sms,
      },
      correlationId,
    );

    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/updateRecentInvite',
      200,
      duration,
      correlationId,
    );

    return ApiResponse.ok(
      result,
      {
        title: 'Success',
        description: 'Invite details updated successfully.',
      },
      { requestId: correlationId, event , headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Correlation-Id,X-Requested-With',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
      },},
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        event.path || '/updateRecentInvite',
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
    if (err instanceof InviteUpdateTooSoonError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        event.path || '/updateRecentInvite',
        429,
        duration,
        correlationId,
      );
      return await ApiResponse.tooManyRequests(
        {
          title: err.message,
          description: 'An error occurred',
        },
        { requestId: correlationId, event },
        {
          code: 'INVITE_UPDATE_TOO_SOON',
          details: [
            {
              message: err.message,
              field: err.field,
              lastUpdatedAt: err.lastUpdatedAt,
              hoursSinceUpdate: err.hoursSinceUpdate,
            } as any,
          ],
        },
      );
    }
    logger.error({
      event: 'updateRecentInvite_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/updateRecentInvite',
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.UPDATE_RECENT_INVITE_FAILED',
      { requestId: correlationId, event },
      {
        code: 'UPDATE_RECENT_INVITE_FAILED',
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
): Promise<APIGatewayProxyResult> => {
  return updateRecentInvite(event, context);
};
