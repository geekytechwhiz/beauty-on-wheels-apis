import { serializeError } from '@api-hub/observability';
import { DeviceService } from '../../services/deviceService';
import { deviceRegistrationSchema } from '../../validation/device.validation';
import type { DeviceRegistrationResultItem } from '../../types/deviceRegistration.types';
import { z } from 'zod';

/** Validated payload from deviceRegistrationSchema. */
export type DeviceRegistrationValidatedPayload = z.infer<typeof deviceRegistrationSchema>;

/** Parameters for registerDevices business logic. */
export interface RegisterDevicesParams {
  validatedPayload: DeviceRegistrationValidatedPayload;
  deviceService: DeviceService;
  correlationId: string | undefined;
  logger: {
    error: (meta: Record<string, unknown>) => void;
  };
}

/** Success response message and status for each device (API contract). */
const DEVICE_REGISTERED_MESSAGE = 'Device successfully registered';
const SUCCESS_STATUS_CODE = 201;

/**
 * Registers each device from the validated payload via DeviceService.
 * Preserves exact response format: { message, statusCode, configDeviceId, deviceId }.
 *
 * @param params - Validated payload, service, correlationId, logger
 * @returns Array of result items per device (same order as input)
 * @throws Re-throws any error from DeviceService.registerDevice after logging
 */
export async function registerDevices(params: RegisterDevicesParams): Promise<DeviceRegistrationResultItem[]> {
  const { validatedPayload, deviceService, correlationId, logger } = params;

  const results = await Promise.all(
    validatedPayload.devices.map(async (device): Promise<DeviceRegistrationResultItem> => {
      try {
        const result = await deviceService.registerDevice(
          {
            userId: validatedPayload.userId,
            organizationId: validatedPayload.organizationId,
            configDeviceId: device.configDeviceId,
            displayName: device.displayName,
            deviceCategory: device.deviceCategory,
            companyName: device.companyName,
            modelName: device.modelName,
            deviceCategoryNum:
              device.deviceCategoryNum !== undefined ? String(device.deviceCategoryNum) : undefined,
          },
          correlationId,
        );
        return {
          message: DEVICE_REGISTERED_MESSAGE,
          statusCode: SUCCESS_STATUS_CODE,
          configDeviceId: result.configDeviceId,
          deviceId: result.deviceId,
        };
      } catch (err) {
        logger.error({
          event: 'device_register_error',
          configDeviceId: device.configDeviceId,
          err: serializeError(err),
        });
        throw err;
      }
    }),
  );

  return results;
}
