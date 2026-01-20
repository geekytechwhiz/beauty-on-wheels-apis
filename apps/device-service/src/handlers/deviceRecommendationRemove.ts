import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { RecommendationService } from '../services/recommendationService';
import { deviceRecommendationRemoveSchema } from '../validation/device.validation';
import { RecommendationNotFoundError, RecommendationCannotRemovePairedError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const recommendationService = new RecommendationService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceRecommendationRemove_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceRecommendationRemove_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/remove', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validation
  const validation = deviceRecommendationRemoveSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'deviceRecommendationRemove_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/remove', 400, duration, correlationId);
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
    await recommendationService.removeRecommendation(validation.data.patientUserId, validation.data.deviceId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/remove', 200, duration, correlationId);
    return ApiResponse.ok(null, 'DEVICE.RECOMMENDATION_REMOVED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof RecommendationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/remove', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.RECOMMENDATION_NOT_FOUND', { requestId: correlationId, event }, { code: 'RECOMMENDATION_NOT_FOUND' });
    }
    if (err instanceof RecommendationCannotRemovePairedError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/remove', 400, duration, correlationId);
      return ApiResponse.badRequest('DEVICE.CANNOT_REMOVE_PAIRED_DEVICE', { requestId: correlationId, event }, { code: 'CANNOT_REMOVE_PAIRED_DEVICE' });
    }
    logger.error({ event: 'deviceRecommendationRemove_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/remove', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.RECOMMENDATION_REMOVE_FAILED', { requestId: correlationId, event }, { code: 'RECOMMENDATION_REMOVE_FAILED' });
  }
};
