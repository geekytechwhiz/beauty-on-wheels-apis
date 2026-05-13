import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { DeviceSearchService } from '../services/device-searchService';
import { deviceSearchSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceSearchService = new DeviceSearchService();

const deviceSearchImpl: any = async (event: any, context?: Context) => {
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
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer
  const authorizer = (event.requestContext as any)?.authorizer;
  const organizationId = authorizer?.organizationID || authorizer?.organizationId || (event as any).organizationID || (body as any).organizationID;
  const userId = authorizer?.userID || authorizer?.userId || (event as any).userID || (body as any).userID;

  const bodyPayload =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  // Validation
  const validation = deviceSearchSchema.safeParse({
    ...bodyPayload,
    organizationID: organizationId,
    userID: userId,
  });
  if (!validation.success) {
    logger.warn({ event: 'deviceSearch_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      {  correlationId: correlationId, event },
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
          return ApiResponse.forbidden(
            {
              title: 'DEVICE.INVALID_ORGANIZATION',
              description: 'Organization must be ROOT for organization-scoped device search',
              severity: 'ERROR',
            },
            {  correlationId: correlationId, event },
            { code: 'INVALID_ORGANIZATION' },
          );
        }
        result = await deviceSearchService.getOrganizationDevices(validation.data.organizationID, validation.data.countryCode);
        break;

      case 'patient':
        if (!validation.data.organizationID) {
          const duration = Date.now() - startTime;
          logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
          return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'organizationID is required for patient action' }] });
        }
        result = await deviceSearchService.getPatientDevices(validation.data.organizationID, validation.data.countryCode);
        break;

      case 'recommend':
        result = await deviceSearchService.getRecommendedDevices(validation.data.userID, validation.data.patientUserId);
        break;

      case 'deviceCategory':
        result = await deviceSearchService.getDeviceCategories();
        break;

      default: {
        const duration = Date.now() - startTime;
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 400, duration, correlationId);
        return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'Invalid action' }] });
      }
    }

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/search', 200, duration, correlationId);
    return ApiResponse.ok(result, { title: 'DEVICE.DEVICE_SEARCH_SUCCESS', description: 'Device search successful', severity: 'SUCCESS' }, {  correlationId: correlationId, event });
  } catch (err) {
    return ApiResponse.internalServerError({
      title: 'DEVICE.SEARCH_FAILED',
      description: 'Device search failed',
      severity: 'ERROR',
    }, {  correlationId: correlationId, event }, { code: 'SEARCH_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.search', deviceSearchImpl, { serviceName: 'device-service' });
