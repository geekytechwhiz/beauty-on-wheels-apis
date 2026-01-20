import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceSearchService } from '../services/device-searchService';
import { deviceSearchSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceSearchService = new DeviceSearchService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceSearch_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceSearch_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer
  const authorizer = (event.requestContext as any)?.authorizer;
  const organizationId = authorizer?.organizationID || authorizer?.organizationId || (event as any).organizationID || (body as any).organizationID;
  const userId = authorizer?.userID || authorizer?.userId || (event as any).userID || (body as any).userID;

  // Validation
  const validation = deviceSearchSchema.safeParse({ ...body, organizationID: organizationId, userID: userId });
  if (!validation.success) {
    logger.warn({ event: 'deviceSearch_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
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
    let result: unknown;

    switch (validation.data.action) {
      case 'organization':
        if (!validation.data.organizationID || validation.data.organizationID.toUpperCase() !== 'ROOT') {
          const duration = Date.now() - startTime;
          logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 403, duration, correlationId);
          return ApiResponse.forbidden('DEVICE.INVALID_ORGANIZATION', { requestId: correlationId, event }, { code: 'INVALID_ORGANIZATION' });
        }
        result = await deviceSearchService.getOrganizationDevices(validation.data.organizationID, validation.data.countryCode);
        break;

      case 'patient':
        if (!validation.data.organizationID) {
          const duration = Date.now() - startTime;
          logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
          return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'organizationID is required for patient action' }] });
        }
        result = await deviceSearchService.getPatientDevices(validation.data.organizationID, validation.data.countryCode);
        break;

      case 'recommend':
        result = await deviceSearchService.getRecommendedDevices(validation.data.userID, validation.data.patientUserId);
        break;

      case 'deviceCategory':
        result = await deviceSearchService.getDeviceCategories();
        break;

      default:
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
        return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'Invalid action' }] });
    }

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 200, duration, correlationId);
    return ApiResponse.ok(result, 'DEVICE.DEVICE_SEARCH_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceSearch_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.SEARCH_FAILED', { requestId: correlationId, event }, { code: 'SEARCH_FAILED' });
  }
};
