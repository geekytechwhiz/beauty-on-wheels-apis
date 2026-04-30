import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { z } from 'zod';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const globalDeviceRepository = new GlobalDeviceRepository();
const orgDeviceRepository = new OrgDeviceRepository();

// Validation schema for device assignment
const deviceAssignSchema = z.object({
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

const deviceOrgAssignImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const awsRequestId = context ? extractAwsRequestId(context) : 'local';
  const correlationId = extractCorrelationId(event.headers);

  const logger = createChildLogger(baseLogger, { awsRequestId, correlationId });
  logger.info({ event: 'deviceOrgAssign_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  } catch (err) {
    logger.error({ event: 'deviceOrgAssign_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/organizations', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validate request body
  const validation = deviceAssignSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'deviceOrgAssign_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/organizations', 400, duration, correlationId);
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

  // Use accountAlias as the organization ID
  const orgId = validation.data.accountAlias;

  logger.info({
    event: 'deviceOrgAssign_start',
    orgId,
    accountAlias: validation.data.accountAlias,
    roleId: validation.data.roleId,
    deviceCount: validation.data.devices.length,
  });

  try {
    return await assignDevicesToOrganization(validation.data, orgId, correlationId, logger, event, startTime);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceOrgAssign_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/organizations', 500, duration, correlationId);

    return ApiResponse.internalServerError(
      {
        title: 'Internal server error',
        description: 'An unexpected error occurred while assigning devices to organization.',
      },
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};

/**
 * Assign devices to organization: POST /devices/organizations
 * Body: { accountAlias, roleId, devices: [...] }
 * Note: accountAlias is the organization ID
 * Deactivates (isActive=false) all existing org rows, then writes the payload with isActive=true (replace semantics).
 */
async function assignDevicesToOrganization(
  data: z.infer<typeof deviceAssignSchema>,
  orgId: string,
  correlationId: string,
  logger: ReturnType<typeof createChildLogger>,
  event: any,
  startTime: number,
) {
  const processedDevices: Array<{
    deviceId: string;
    status: 'success' | 'failed';
    error?: string;
  }> = [];

  logger.info({ event: 'deviceOrgAssign_deactivating_previous_org_devices', orgId });
  await orgDeviceRepository.deactivateAllOrgDevicesForOrganization(orgId);

  // Process each device
  for (const device of data.devices) {
    const deviceId = device.deviceId;

    try {
      logger.info({ event: 'device_processing_start', deviceId, orgId });

      // Step 1: Check if device exists in global registry
      let deviceExists = false;
      try {
        const existingDevice = await globalDeviceRepository.getDeviceById(deviceId);
        deviceExists = !!existingDevice;
        logger.info({ event: 'device_existence_check', deviceId, deviceExists });
      } catch (checkErr) {
        logger.warn({ event: 'device_check_error', deviceId, err: serializeError(checkErr) });
      }

      // Step 2: Register device to global registry if it doesn't exist
      // Global device pattern: pk: DEVICE_LIST, sk: CATEGORY#${category}#${deviceId}
      if (!deviceExists) {
        logger.info({ event: 'device_registering_to_global', deviceId });
        await globalDeviceRepository.createGlobalDevice({
          deviceId: device.deviceId,
          category: device.category,
          name: device.name,
          displayName: device.displayName,
          deviceImage: device.deviceImage,
          countriesSupported: device.countriesSupported || [],
          manufacturerImage: device.manufacturerImage,
          manufacturerName: device.manufacturerName,
          template: device.template,
          deviceDetails: device.deviceDetails,
          supportedVitals: device.supportedVitals || [],
          enabled: true,
        });
        logger.info({ event: 'device_registered_to_global', deviceId });
      }

      

      // Step 3: Assign device to organization using ORG_DEVICES pattern
      // Organization device pattern: pk: ORG_DEVICES#{orgId}, sk: {deviceId}
      logger.info({ event: 'device_assigning_to_org', deviceId, orgId });
      await orgDeviceRepository.addOrgDevice(orgId, {
        deviceId: device.deviceId,
        category: device.category,
        name: device.name,
        enabled: true,
        isAutoSyncSupported: true,
        displayName: device.displayName,
        deviceImage: device.deviceImage,
        countriesSupported: device.countriesSupported,
        manufacturerImage: device.manufacturerImage,
        manufacturerName: device.manufacturerName,
        template: device.template,
        deviceDetails: device.deviceDetails,
        supportedVitals: device.supportedVitals,
      });

      logger.info({ event: 'device_assigned_to_org_success', deviceId, orgId });

      processedDevices.push({
        deviceId,
        status: 'success',
      });
    } catch (deviceErr) {
      const errorMessage = deviceErr instanceof Error ? deviceErr.message : 'Unknown error';
      logger.error({ event: 'device_processing_error', deviceId, err: serializeError(deviceErr) });

      processedDevices.push({
        deviceId,
        status: 'failed',
        error: errorMessage,
      });
    }
  }

  // Identify missing vitals: input supportedVitals that have no device in the org
  const inputSupportedVitals = data.supportedVitals ?? [];
  if (inputSupportedVitals.length > 0) {
    const orgDevices = await orgDeviceRepository.getOrgDevices(orgId);
    const deviceCoveredVitals = new Set<string>();
    for (const dev of orgDevices) {
      if (dev.sk === 'NON-DEVICES' || dev.isActive === false) continue;
      for (const v of dev.supportedVitals ?? []) {
        deviceCoveredVitals.add(v);
      }
    }
    const missingVitals = inputSupportedVitals.filter((v) => !deviceCoveredVitals.has(v));
    await orgDeviceRepository.upsertNonDeviceVitals(orgId, missingVitals);
    if (missingVitals.length > 0) {
      logger.info({ event: 'non_device_vitals_stored', missingVitals, count: missingVitals.length });
    }
  }

  // Analyze results
  const failedDevices = processedDevices.filter((d) => d.status === 'failed');
  const successfulDevices = processedDevices.filter((d) => d.status === 'success');
  const duration = Date.now() - startTime;

  // All devices failed
  if (successfulDevices.length === 0) {
    logger.error({
      event: 'deviceOrgAssign_all_failed',
      failedCount: failedDevices.length,
      failures: failedDevices,
    });

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/organizations', 400, duration, correlationId);

    return ApiResponse.badRequest(
      {
        title: 'Device assignment failed',
        description: 'All devices failed to be assigned to the organization.',
      },
      { requestId: correlationId, event },
      {
        code: 'DEVICE_ASSIGNMENT_FAILED',
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
      event: 'deviceOrgAssign_partial_success',
      successCount: successfulDevices.length,
      failedCount: failedDevices.length,
    });

    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/organizations', 207, duration, correlationId);

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
          title: 'Devices partially updated',
          description: `${successfulDevices.length} device(s) successfully assigned. ${failedDevices.length} device(s) failed.`,
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
          requestId: correlationId,
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      }),
    };
  }

  // All devices processed successfully
  logger.info({
    event: 'deviceOrgAssign_success',
    orgId,
    deviceCount: successfulDevices.length,
  });

  logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/organizations', 201, duration, correlationId);

  return ApiResponse.created(
    null,
    {
      title: 'Device is successfully updated',
      description: 'Device is successfully updated.',
    },
    { requestId: correlationId, event },
  );
}

export const handler = withStandardApiGatewayPipeline('device.orgAssign', deviceOrgAssignImpl, { serviceName: 'device-service' });
