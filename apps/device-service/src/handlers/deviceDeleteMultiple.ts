import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceDeleteMultipleSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

const deviceDeleteMultipleImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceDeleteMultiple_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceDeleteMultiple_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/delete-multiple', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer
  const authorizer = (event.requestContext as any)?.authorizer;
  const userId = authorizer?.userID || authorizer?.userId || (event as any).userID || (body as any).userID;

  // Validation
  const validation = deviceDeleteMultipleSchema.safeParse({ ...body, userId });
  if (!validation.success) {
    logger.warn({ event: 'deviceDeleteMultiple_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/delete-multiple', 400, duration, correlationId);
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
    const targetUserId = validation.data.userId || userId || '';
    if (!targetUserId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/delete-multiple', 400, duration, correlationId);
      return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] });
    }

    // devices array contains configDeviceIds
    const results = await deviceService.deleteMultipleDevices(targetUserId, validation.data.devices, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/delete-multiple', 200, duration, correlationId);
    return ApiResponse.ok(results, 'DEVICE.DEVICES_DELETED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceDeleteMultiple_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/delete-multiple', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.DELETE_MULTIPLE_FAILED', { requestId: correlationId, event }, { code: 'DELETE_MULTIPLE_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.deleteMultiple', deviceDeleteMultipleImpl, { serviceName: 'device-service' });
