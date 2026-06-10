import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { z } from 'zod';

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
/**
 * Assign devices to organization: POST /devices/organizations
 * Body: { accountAlias, roleId, devices: [...] }
 * Note: accountAlias is the organization ID
 * Deactivates (isActive=false) all existing org rows, then writes the payload with isActive=true (replace semantics).
 */
async function assignDevicesToOrganization(req: LambdaRequest) {
  const { body } = req;
  const { accountAlias,  devices, supportedVitals } = body;
  const orgId = accountAlias;
  // const startTime = Date.now();
  const processedDevices: Array<{
    deviceId: string;
    status: 'success' | 'failed';
    error?: string;
  }> = [];

  await orgDeviceRepository.deactivateAllOrgDevicesForOrganization(orgId);

  // Process each device
  for (const device of devices) {
    const deviceId = device.deviceId;

    try {
      // Step 1: Check if device exists in global registry
      let deviceExists = false;
      try {
        const existingDevice =
          await globalDeviceRepository.getDeviceById(deviceId);
        deviceExists = !!existingDevice;
      } catch (checkErr) {
        // logger.warn({ event: 'device_check_error', deviceId, err: serializeError(checkErr) });
      }

      // Step 2: Register device to global registry if it doesn't exist
      // Global device pattern: pk: DEVICE_LIST, sk: CATEGORY#${category}#${deviceId}
      if (!deviceExists) {
        // logger.info({ event: 'device_registering_to_global', deviceId });
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
      }

      // Step 3: Assign device to organization using ORG_DEVICES pattern
      // Organization device pattern: pk: ORG_DEVICES#{orgId}, sk: {deviceId}
      // logger.info({ event: 'device_assigning_to_org', deviceId, orgId });
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

      processedDevices.push({
        deviceId,
        status: 'success',
      });
    } catch (deviceErr) {
      const errorMessage =
        deviceErr instanceof Error ? deviceErr.message : 'Unknown error';

      processedDevices.push({
        deviceId,
        status: 'failed',
        error: errorMessage,
      });
    }
  }

  // Identify missing vitals: input supportedVitals that have no device in the org
  const inputSupportedVitals = supportedVitals ?? [];
  if (inputSupportedVitals.length > 0) {
    const orgDevices = await orgDeviceRepository.getOrgDevices(orgId);
    const deviceCoveredVitals = new Set<string>();
    for (const dev of orgDevices) {
      if (dev.sk === 'NON-DEVICES' || dev.isActive === false) continue;
      for (const v of dev.supportedVitals ?? []) {
        deviceCoveredVitals.add(v);
      }
    }
    const missingVitals = inputSupportedVitals.filter(
      (v) => !deviceCoveredVitals.has(v),
    );
    await orgDeviceRepository.upsertNonDeviceVitals(orgId, missingVitals);
    if (missingVitals.length > 0) {
      // logger.info({ event: 'non_device_vitals_stored', missingVitals, count: missingVitals.length });
    }
  }

  // Analyze results
  const failedDevices = processedDevices.filter((d) => d.status === 'failed');
  const successfulDevices = processedDevices.filter(
    (d) => d.status === 'success',
  );
  // const duration = Date.now() - startTime;
  // All devices failed
  if (successfulDevices.length === 0) {
    return {
      code: 'DEVICE_ASSIGNMENT_FAILED',
      details: failedDevices.map((d) => ({
        field: d.deviceId,
        message: d.error || 'Unknown error',
      })),
    };
  }

  // Partial success
  if (failedDevices.length > 0) {
    return {
      successful: successfulDevices.map((d) => d.deviceId),
      failed: failedDevices.map((d) => ({
        deviceId: d.deviceId,
        error: d.error,
      })),
    };
  }
}
export const handler = withApiHandler(
  {
    // useLegacyResponseFormat: true,
    operation: 'device.orgAssign',
    // validator: deviceAssignSchema,
    bodySchema: deviceAssignSchema,
  },
  (req: LambdaRequest) => assignDevicesToOrganization(req),
);

export default handler;
 