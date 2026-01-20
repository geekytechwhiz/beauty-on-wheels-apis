import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { RecommendationService } from '../services/recommendationService';
import { deviceRecommendationAddSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const recommendationService = new RecommendationService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceRecommendationAdd_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceRecommendationAdd_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer
  const authorizer = (event.requestContext as any)?.authorizer;
  const doctorId = authorizer?.userID || authorizer?.userId || (event as any).userID || (body as any).userID;
  const organizationId = authorizer?.organizationID || authorizer?.organizationId || (event as any).organizationID || (body as any).organizationID;

  // Validation
  const validation = deviceRecommendationAddSchema.safeParse({ ...body, userID: doctorId, organizationID: organizationId });
  if (!validation.success) {
    logger.warn({ event: 'deviceRecommendationAdd_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 400, duration, correlationId);
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
    if (!validation.data.userID) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 401, duration, correlationId);
      return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED', details: [{ message: 'Doctor ID is required' }] });
    }

    if (!validation.data.organizationID) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 400, duration, correlationId);
      return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'organizationID is required' }] });
    }

    await recommendationService.recommendDevices(
      validation.data.patientUserId,
      validation.data.userID,
      validation.data.doctorName,
      validation.data.organizationID,
      validation.data.devices,
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 200, duration, correlationId);
    return ApiResponse.ok(null, 'DEVICE.RECOMMENDATION_ADDED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceRecommendationAdd_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/recommendations/add', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.RECOMMENDATION_ADD_FAILED', { requestId: correlationId, event }, { code: 'RECOMMENDATION_ADD_FAILED' });
  }
};
