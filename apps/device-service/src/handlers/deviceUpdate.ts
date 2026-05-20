import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const globalDeviceRepository = new GlobalDeviceRepository();

const deviceUpdateImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceUpdate_received' });

  // Extract deviceId from path parameters
  const deviceId = event.pathParameters?.deviceId;
  if (!deviceId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{deviceId}', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'deviceId is required in path' }] });
  }

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceUpdate_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${deviceId}`, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validate body is an object
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${deviceId}`, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'Request body must be a valid object' }] });
  }

  // Remove deviceId, pk, sk, sk3, sk4 from updates (these are key fields and cannot be updated)
  // Only the fields provided in the request body will be updated; all other fields remain unchanged
  const bodyObj = body as Record<string, unknown>;
  const { deviceId: _, pk, sk, sk3, sk4, ...updates } = bodyObj;

  // Check if there are any updates
  if (Object.keys(updates).length === 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${deviceId}`, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'No valid fields to update' }] });
  }

  // Log which fields will be updated (for debugging/auditing)
  logger.info({ event: 'deviceUpdate_fields', deviceId, fieldsToUpdate: Object.keys(updates) });

  try {
    // Update device (method will check if device exists first)
    // Only the provided fields will be updated; all other fields remain unchanged
    const updatedDevice = await globalDeviceRepository.updateGlobalDevice(deviceId, updates);

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${deviceId}`, 200, duration, correlationId);
    return ApiResponse.ok(updatedDevice, 'DEVICE.DEVICE_UPDATED_SUCCESS', {  correlationId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${deviceId}`, 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }
    logger.error({ event: 'deviceUpdate_error', err: serializeError(err), deviceId });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${deviceId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.UPDATE_FAILED', {  correlationId: correlationId, event }, { code: 'UPDATE_FAILED' });
  }
};

export const handler = withApiHandler({ operation: 'device.update' }, deviceUpdateImpl);