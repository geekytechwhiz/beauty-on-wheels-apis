import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

const deviceMetadataUpdateImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceMetadataUpdate_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;

  // Validate path parameters
  if (!deviceId) {
    logger.warn({ event: 'deviceMetadataUpdate_validation_error', deviceId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{deviceId}/metadata', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'deviceId is required in path parameters' }],
      },
    );
  }

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceMetadataUpdate_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{deviceId}/metadata', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validate body contains metadata
  const metadata = (body as any)?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    logger.warn({ event: 'deviceMetadataUpdate_validation_error', body });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{deviceId}/metadata', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'metadata object is required in request body' }],
      },
    );
  }

  try {
    const result = await deviceMappingService.upsertDeviceMetadata(deviceId, metadata, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{deviceId}/metadata', 200, duration, correlationId);
    return ApiResponse.ok(result, 'DEVICE.DEVICE_METADATA_UPDATED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceMetadataUpdate_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{deviceId}/metadata', 500, duration, correlationId);

    if (err instanceof DeviceNotFoundError) {
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', { requestId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }

    return ApiResponse.internalServerError('DEVICE.METADATA_UPDATE_FAILED', { requestId: correlationId, event }, { code: 'METADATA_UPDATE_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.metadataUpdate', deviceMetadataUpdateImpl, { serviceName: 'device-service' });
