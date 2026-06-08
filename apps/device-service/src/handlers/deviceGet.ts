import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const globalDeviceRepository = new GlobalDeviceRepository();

const deviceGetImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceGet_received' });

  // Extract deviceId from path parameters
  const deviceId = event.pathParameters?.deviceId;
  if (!deviceId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'deviceId is required in path' }] });
  }

  try {
    // Get device by deviceId
    const device = await globalDeviceRepository.getDeviceById(deviceId);
    
    if (!device) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/devices/${deviceId}`, 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }

    // Return all device information including all fields
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/devices/${deviceId}`, 200, duration, correlationId);
    return ApiResponse.ok(device, 'DEVICE.DEVICE_RETRIEVED_SUCCESS', {  correlationId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceGet_error', err: serializeError(err), deviceId });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/devices/${deviceId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.RETRIEVAL_FAILED', {  correlationId: correlationId, event }, { code: 'RETRIEVAL_FAILED' });
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.get' }, deviceGetImpl);
