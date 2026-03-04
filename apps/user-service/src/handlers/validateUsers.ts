import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  extractCorrelationId,
  logHttpRequest,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { validateUserExistsSchema } from '../validation/user.validation';
import { UserValidationService } from '../services/userValidation.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const PATH = '/users/validateusers';

const userValidationService = new UserValidationService();

export async function main(
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

  logger.info({ event: 'validateUsers_received' });

  let body: unknown;

  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({
      event: 'validateUsers_parse_error',
      err: serializeError(err as Error),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const validationResult = validateUserExistsSchema.safeParse(body);

  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    );
  }

  const { provider, externalId, tenantId } = validationResult.data;

  try {
    const { exists, cognitoUser } = await userValidationService.validateUserExists(
      { provider, externalId, tenantId: tenantId || '' },
      correlationId,
    );

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);

    if (exists) {
      return ApiResponse.ok(
        {
          exists: true,
          cognitoUser,
        },
        'USER.USER_ALREADY_EXISTS',
        { requestId: correlationId, event },
      );
    }

    return ApiResponse.ok(
      {
        exists: false,
      },
      'USER.USER_NOT_FOUND',
      { requestId: correlationId, event },
    );
  } catch (err) {
    logger.error({
      event: 'validateUsers_internal_error',
      err: serializeError(err as Error),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
}

