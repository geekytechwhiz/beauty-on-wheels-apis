import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

const deviceFileUploadImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceFileUpload_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;

  // Validate path parameters
  if (!deviceId) {
    logger.warn({ event: 'deviceFileUpload_validation_error', deviceId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/files', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      {  correlationId: correlationId, event },
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
    logger.error({ event: 'deviceFileUpload_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/files', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validate body
  const fileName = (body as any)?.fileName;
  const fileUrl = (body as any)?.fileUrl;
  const fileSize = (body as any)?.fileSize;
  const mimeType = (body as any)?.mimeType;

  if (!fileName || !fileUrl) {
    logger.warn({ event: 'deviceFileUpload_validation_error', body });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/files', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      {  correlationId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'fileName and fileUrl are required in request body' }],
      },
    );
  }

  try {
    const fileReference = await deviceMappingService.createDeviceFileReference(
      deviceId,
      fileName,
      fileUrl,
      fileSize,
      mimeType,
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/files', 201, duration, correlationId);
    return ApiResponse.created(fileReference, 'DEVICE.DEVICE_FILE_UPLOADED_SUCCESS', {  correlationId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceFileUpload_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/files', 500, duration, correlationId);

    if (err instanceof DeviceNotFoundError) {
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }

    return ApiResponse.internalServerError('DEVICE.FILE_UPLOAD_FAILED', {  correlationId: correlationId, event }, { code: 'FILE_UPLOAD_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.fileUpload', deviceFileUploadImpl, { serviceName: 'device-service' });
