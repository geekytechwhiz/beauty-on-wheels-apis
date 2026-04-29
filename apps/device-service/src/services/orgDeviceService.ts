import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { OrgDevice } from '../models';
import { DeviceNotFoundError, InvalidOrganizationError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';

const baseLogger = createLogger({ service: 'org-device-service', redactPII: true });

export class OrgDeviceService {
  private repository: OrgDeviceRepository;

  constructor() {
    this.repository = new OrgDeviceRepository();
  }

  /**
   * Add devices to organization
   */
  async addDevicesToOrganization(
    organizationId: string,
    devices: Array<{ deviceId: string; category: string; name: string }>,
    correlationId?: string,
  ): Promise<Array<{ success: boolean; deviceId: string; message?: string }>> {
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, count: devices.length });
    logger.info({ event: 'service_addDevicesToOrg_start' });

    // Validate organization is ROOT (this should be checked in handler/authorizer)
    if (!organizationId || organizationId.toUpperCase() !== 'ROOT') {
      throw new InvalidOrganizationError('Only ROOT organization can manage devices');
    }

    const results = await Promise.allSettled(
      devices.map(async (device) => {
        try {
          await this.repository.addOrgDevice(organizationId, device);

          // Publish event
          await publishEvent(
            {
              eventType: 'Organization.DeviceAdded',
              organizationId,
              deviceId: device.deviceId,
              timestamp: Date.now(),
            },
            correlationId,
          );

          return { success: true, deviceId: device.deviceId, message: 'Devices added in organization successfully' };
        } catch (err) {
          logger.warn({ event: 'add_device_failed', deviceId: device.deviceId, err: serializeError(err) });
          return { success: false, deviceId: device.deviceId, message: (err as Error).message };
        }
      }),
    );

    return results.map((result) => (result.status === 'fulfilled' ? result.value : { success: false, deviceId: '', message: 'Unknown error' }));
  }

  /**
   * Remove devices from organization
   */
  async removeDevicesFromOrganization(
    organizationId: string,
    deviceIds: string[],
    correlationId?: string,
  ): Promise<Array<{ success: boolean; deviceId: string; message?: string }>> {
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, count: deviceIds.length });
    logger.info({ event: 'service_removeDevicesFromOrg_start' });

    if (!organizationId || organizationId.toUpperCase() !== 'ROOT') {
      throw new InvalidOrganizationError('Only ROOT organization can manage devices');
    }

    const results = await Promise.allSettled(
      deviceIds.map(async (deviceId) => {
        try {
          await this.repository.removeOrgDevice(organizationId, deviceId);
          return { success: true, deviceId, message: 'Device removed from organization successfully' };
        } catch (err) {
          logger.warn({ event: 'remove_device_failed', deviceId, err: serializeError(err) });
          if (err instanceof DeviceNotFoundError) {
            return { success: false, deviceId, message: err.message };
          }
          return { success: false, deviceId, message: (err as Error).message };
        }
      }),
    );

    return results.map((result) => (result.status === 'fulfilled' ? result.value : { success: false, deviceId: '', message: 'Unknown error' }));
  }

  /**
   * Update organization device settings
   */
  async updateOrgDevice(
    organizationId: string,
    deviceId: string,
    updates: { enabled?: boolean; isAutoSyncSupported?: boolean },
    correlationId?: string,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, deviceId });
    logger.info({ event: 'service_updateOrgDevice_start' });

    if (!organizationId || organizationId.toUpperCase() !== 'ROOT') {
      throw new InvalidOrganizationError('Only ROOT organization can manage devices');
    }

    await this.repository.updateOrgDevice(organizationId, deviceId, updates);
    logger.info({ event: 'org_device_updated', deviceId });
  }

  /**
   * Get organization devices
   */
  async getOrganizationDevices(organizationId: string): Promise<OrgDevice[]> {
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_getOrganizationDevices_start' });

    const devices = await this.repository.getOrgDevices(organizationId);
    const active = devices.filter((d) => d.isActive !== false);
    logger.info({ event: 'service_getOrganizationDevices_success', count: active.length });
    return active;
  }
}
