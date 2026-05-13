import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { OrgDeviceService } from '../services/orgDeviceService';
import { orgDeviceManageSchema } from '../validation/device.validation';
import { InvalidOrganizationError, DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const orgDeviceService = new OrgDeviceService();

const orgDeviceManageImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'orgDeviceManage_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'orgDeviceManage_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer
  const authorizer = (event.requestContext as any)?.authorizer;
  const organizationId = authorizer?.organizationID || authorizer?.organizationId || (event as any).organizationID || (body as any).organizationID || (body as any).organizationId;

  const bodyObject = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  // Validation
  const validation = orgDeviceManageSchema.safeParse({ ...bodyObject, organizationID: organizationId });
  if (!validation.success) {
    logger.warn({ event: 'orgDeviceManage_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
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
    const targetOrgId = validation.data.organizationId || validation.data.organizationID || organizationId;
    if (!targetOrgId || targetOrgId.toUpperCase() !== 'ROOT') {
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 403, duration, correlationId);
      return ApiResponse.forbidden('DEVICE.INVALID_ORGANIZATION', {  correlationId: correlationId, event }, { code: 'INVALID_ORGANIZATION' });
    }

    let result: unknown;

    switch (validation.data.action) {
      case 'add': {
        if (!validation.data.devices || validation.data.devices.length === 0) {
          logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 400, Date.now() - startTime, correlationId);
          return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'devices array is required for add action' }] });
        }
        result = await orgDeviceService.addDevicesToOrganization(targetOrgId, validation.data.devices, correlationId);
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 201, Date.now() - startTime, correlationId);
        return ApiResponse.created(result, 'DEVICE.ORGANIZATION_DEVICES_ADDED_SUCCESS', {  correlationId: correlationId, event });
      }

      case 'remove': {
        if (!validation.data.devices || validation.data.devices.length === 0) {
          logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 400, Date.now() - startTime, correlationId);
          return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'devices array is required for remove action' }] });
        }
        const deviceIds = validation.data.devices.map((d) => d.deviceId);
        result = await orgDeviceService.removeDevicesFromOrganization(targetOrgId, deviceIds, correlationId);
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 200, Date.now() - startTime, correlationId);
        return ApiResponse.ok(result, 'DEVICE.ORGANIZATION_DEVICES_REMOVED_SUCCESS', {  correlationId: correlationId, event });
      }

      case 'update': {
        if (!validation.data.deviceId) {
          logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 400, Date.now() - startTime, correlationId);
          return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'deviceId is required for update action' }] });
        }
        await orgDeviceService.updateOrgDevice(
          targetOrgId,
          validation?.data?.deviceId ?? '',
          {
            enabled: validation?.data?.enabled,
            isAutoSyncSupported: validation?.data?.isAutoSyncSupported,
          },
          correlationId,
        );
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 200, Date.now() - startTime, correlationId);
        return ApiResponse.ok(null, 'DEVICE.ORGANIZATION_DEVICE_UPDATED_SUCCESS', {  correlationId: correlationId, event });
      }

      default: {
        logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 400, Date.now() - startTime, correlationId);
        return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'Invalid action' }] });
      }
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof InvalidOrganizationError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 403, duration, correlationId);
      return ApiResponse.forbidden('DEVICE.INVALID_ORGANIZATION', {  correlationId: correlationId, event }, { code: 'INVALID_ORGANIZATION' });
    }
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }
    logger.error({ event: 'orgDeviceManage_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/org/manage', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.ORG_DEVICE_MANAGE_FAILED', {  correlationId: correlationId, event }, { code: 'ORG_DEVICE_MANAGE_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.orgManage', orgDeviceManageImpl, { serviceName: 'device-service' });
