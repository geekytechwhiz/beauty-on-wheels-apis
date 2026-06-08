import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { z } from 'zod';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const orgDeviceRepository = new OrgDeviceRepository();

// Validation schema for device removal
const deviceRemoveSchema = z.object({
  accountAlias: z.string().min(1),
  roleId: z.string().optional(),
  devices: z
    .array(
      z.object({
        deviceId: z.string().min(1),
        category: z.string().min(1),
        name: z.string().min(1),
        displayName: z.string().optional(),
        deviceImage: z.string().optional(),
        countriesSupported: z.array(z.string()).optional(),
        manufacturerImage: z.string().optional(),
        manufacturerName: z.string().optional(),
        template: z.number().optional(),
        deviceDetails: z.string().optional(),
        supportedVitals: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  supportedVitals: z.array(z.string()).optional(),
});

const deviceOrgRemoveImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const awsRequestId = context ? extractAwsRequestId(context) : 'local';
  const correlationId = extractCorrelationId(event.headers);

  const logger = createChildLogger(baseLogger, { awsRequestId, correlationId });
  logger.info({ event: 'deviceOrgRemove_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  } catch (err) {
    logger.error({ event: 'deviceOrgRemove_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validate request body
  const validation = deviceRemoveSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'deviceOrgRemove_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 400, duration, correlationId);
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

  // Use accountAlias as the organization ID
  const orgId = validation.data.accountAlias;

  logger.info({
    event: 'deviceOrgRemove_start',
    orgId,
    accountAlias: validation.data.accountAlias,
    roleId: validation.data.roleId,
    deviceCount: validation.data.devices.length,
  });

  try {
    return await removeDevicesFromOrganization(validation.data, orgId, correlationId, logger, event, startTime);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceOrgRemove_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 500, duration, correlationId);

    return ApiResponse.internalServerError(
      {
        title: 'Internal server error',
        description: 'An unexpected error occurred while syncing organization devices.',
      },
      {  correlationId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};

/**
 * Sync organization devices: Only keep specified devices, remove all others
 * POST /devices/remove/organizations
 * Body: { accountAlias, roleId, devices: [...] }
 * Note: accountAlias is the organization ID
 * Logic: Devices in payload remain assigned, all others are removed
 */
async function removeDevicesFromOrganization(
  data: z.infer<typeof deviceRemoveSchema>,
  orgId: string,
  correlationId: string,
  logger: ReturnType<typeof createChildLogger>,
  event: any,
  startTime: number,
) {
  // Step 1: Get all current devices for the organization
  logger.info({ event: 'fetching_current_org_devices', orgId });
  const currentDevices = await orgDeviceRepository.getOrgDevices(orgId);
  
  // console.log('=== CURRENT DEVICES IN ORGANIZATION ===');
  // console.log('Organization ID:', orgId);
  // console.log('Current device count:', currentDevices.length);
  // console.log('Current device IDs:', currentDevices.map(d => d.deviceId));
  // console.log('Current devices:', JSON.stringify(currentDevices, null, 2));
  
  logger.info({ 
    event: 'current_devices_fetched', 
    orgId, 
    currentDeviceCount: currentDevices.length,
    currentDeviceIds: currentDevices.map(d => d.deviceId)
  });

  // Step 2: Extract device IDs from the payload (devices to keep)
  const devicesToKeep = new Set(data.devices.map(d => d.deviceId));
  
  // console.log('=== DEVICES TO KEEP (FROM PAYLOAD) ===');
  // console.log('Devices to keep:', Array.from(devicesToKeep));
  
  logger.info({ 
    event: 'devices_to_keep', 
    orgId, 
    keepDeviceCount: devicesToKeep.size,
    keepDeviceIds: Array.from(devicesToKeep)
  });

  // Step 3: Identify devices to remove (current devices NOT in the payload)
  const devicesToRemove = currentDevices.filter(device => !devicesToKeep.has(device.deviceId));
  
  // console.log('=== DEVICES TO REMOVE ===');
  // console.log('Remove device count:', devicesToRemove.length);
  // console.log('Remove device IDs:', devicesToRemove.map(d => d.deviceId));
  
  logger.info({ 
    event: 'devices_to_remove_identified', 
    orgId, 
    removeDeviceCount: devicesToRemove.length,
    removeDeviceIds: devicesToRemove.map(d => d.deviceId)
  });

  // If no devices to remove, return success
  if (devicesToRemove.length === 0) {
    logger.info({ event: 'no_devices_to_remove', orgId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 200, duration, correlationId);
    
    return ApiResponse.ok(
      { 
        message: 'Devices synced successfully',
        removed: 0,
        kept: devicesToKeep.size
      },
      {
        title: 'Device unassign success',
        description: 'The device unassign completed successfully.',
        severity: 'SUCCESS',
      },
      {  correlationId: correlationId, event },
    );
  }

  const processedDevices: Array<{
    deviceId: string;
    status: 'success' | 'failed';
    error?: string;
  }> = [];

  // Step 4: Remove devices that are not in the payload
  for (const device of devicesToRemove) {
    const deviceId = device.deviceId;

    try {
      logger.info({ event: 'device_removing_from_org', deviceId, orgId });

      // Remove device from organization using ORG_DEVICES pattern
      await orgDeviceRepository.removeOrgDevice(orgId, deviceId);

      logger.info({ event: 'device_removed_from_org_success', deviceId, orgId });

      processedDevices.push({
        deviceId,
        status: 'success',
      });
    } catch (deviceErr) {
      const errorMessage = deviceErr instanceof Error ? deviceErr.message : 'Unknown error';
      logger.error({ event: 'device_removal_error', deviceId, err: serializeError(deviceErr) });

      processedDevices.push({
        deviceId,
        status: 'failed',
        error: errorMessage,
      });
    }
  }

  // Analyze results
  const failedDevices = processedDevices.filter((d) => d.status === 'failed');
  const successfulDevices = processedDevices.filter((d) => d.status === 'success');
  const duration = Date.now() - startTime;

  // All devices failed
  if (successfulDevices.length === 0) {
    logger.error({
      event: 'deviceOrgRemove_all_failed',
      failedCount: failedDevices.length,
      failures: failedDevices,
    });

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 400, duration, correlationId);

    return ApiResponse.badRequest(
      {
        title: 'Device removal failed',
        description: 'All devices failed to be removed from the organization.',
      },
      {  correlationId: correlationId, event },
      {
        code: 'DEVICE_REMOVAL_FAILED',
        details: failedDevices.map((d) => ({
          field: d.deviceId,
          message: d.error || 'Unknown error',
        })),
      },
    );
  }

  // Partial success
  if (failedDevices.length > 0) {
    logger.warn({
      event: 'deviceOrgRemove_partial_success',
      successCount: successfulDevices.length,
      failedCount: failedDevices.length,
    });

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 207, duration, correlationId);

    return {
      statusCode: 207,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({
        success: true,
        statusCode: 207,
        message: {
          title: 'Devices partially removed',
          description: `${successfulDevices.length} device(s) successfully removed. ${failedDevices.length} device(s) failed.`,
          severity: 'WARNING',
        },
        data: {
          successful: successfulDevices.map((d) => d.deviceId),
          failed: failedDevices.map((d) => ({
            deviceId: d.deviceId,
            error: d.error,
          })),
        },
        error: null,
        meta: {
           correlationId: correlationId,
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      }),
    };
  }

  // All devices removed successfully
  logger.info({
    event: 'deviceOrgRemove_success',
    orgId,
    removedCount: successfulDevices.length,
    keptCount: data.devices.length,
  });

  logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/remove/organizations', 200, duration, correlationId);

  return ApiResponse.ok(
    { 
      message: 'Devices removed from organization successfully',
      removed: successfulDevices.length,
      kept: data.devices.length
    },
    {
      title: 'Device unassign success',
      description: 'The device unassign completed successfully.',
      severity: 'SUCCESS',
    },
    {  correlationId: correlationId, event },
  );
}

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.orgRemove' }, deviceOrgRemoveImpl);
