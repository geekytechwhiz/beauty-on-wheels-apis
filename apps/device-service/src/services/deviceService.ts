import { DeviceRepository } from '../repositories/deviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { DeviceUserEntry, Device } from '../models';
import { DeviceNotFoundError, DeviceNotInOrganizationError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { completeUserTask } from '../utils/task-completion';
import { isThirdPartyApp } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });

export class DeviceService {
  private deviceRepository: DeviceRepository;
  private orgDeviceRepository: OrgDeviceRepository;
  private globalDeviceRepository: GlobalDeviceRepository;

  constructor() {
    this.deviceRepository = new DeviceRepository();
    this.orgDeviceRepository = new OrgDeviceRepository();
    this.globalDeviceRepository = new GlobalDeviceRepository();
  }

  /**
   * Register/pair a device with a user
   */
  async registerDevice(
    data: {
      userId: string;
      organizationId: string;
      devices: {
        configDeviceId: string;
        displayName: string;
        deviceCategory: string;
        companyName: string;
        modelName: string;
        // platform: string;
        // macAddress?: string;
        // localName?: string;
        // isAutoSyncEnabled: boolean;
        // isAutoSyncSupported: boolean;
        // isSync: boolean;
        // usesExtensionProtocol: boolean;
        // supportsUserAuthentication: boolean;
        // autoSyncDelay: number;
        // userIndex?: number;
        // noOfUsers: number;
        // lastReadingTimeStamp?: number;
        // lastSequenceNumber?: string;
        // databaseUpdateFlag?: boolean;
        // databaseChangeIncrement?: number;
        // isDeviceDeleted?: boolean;
        // iOSIdentifier?: string;
        // isEagleDevice?: boolean;
        deviceCategoryNum?: string;
      },
    },
    correlationId?: string,
  ): Promise<{ deviceId: string; configDeviceId: string }> {
    const logger = createChildLogger(baseLogger, { correlationId, userId: data.userId, configDeviceId: data.devices.configDeviceId });
    logger.info({ event: 'service_registerDevice_start' });

    try {
      // Check if device is already paired
      const existing = await this.deviceRepository.getDeviceByConfigId(data.userId, data.devices.configDeviceId);
      if (existing && existing.sk2 === 'STATUS#ACTIVE') {
        logger.warn({ event: 'device_already_paired', configDeviceId: data.devices.configDeviceId });
        // Return existing device info
        return { deviceId: existing.deviceId, configDeviceId: data.devices.configDeviceId };
      }

      // For non-third-party devices, validate device is available in organization
      if (!isThirdPartyApp(data.devices.deviceCategory)) {
        const isAvailable = await this.orgDeviceRepository.isDeviceInOrganization(data.organizationId, data.devices.configDeviceId);
        if (!isAvailable) {
          // Try to get device from global device list to get the deviceId
          const globalDevice = await this.globalDeviceRepository.getDeviceById(data.devices.configDeviceId);
          if (!globalDevice || !globalDevice.enabled) {
            throw new DeviceNotInOrganizationError(data.devices.configDeviceId, data.organizationId);
          }
        }
      }

      // Create device user entry with defaults for required fields not in validation schema
      const deviceEntry = await this.deviceRepository.createDeviceUserEntry({
        userId: data.userId,
        configDeviceId: data.devices.configDeviceId,
        displayName: data.devices.displayName,
        deviceCategory: data.devices.deviceCategory,
        companyName: data.devices.companyName,
        modelName: data.devices.modelName,
        platform: '',
        macAddress: undefined,
        localName: undefined,
        isAutoSyncEnabled: false,
        isAutoSyncSupported: false,
        isSync: false,
        usesExtensionProtocol: false,
        supportsUserAuthentication: false,
        autoSyncDelay: 0,
        userIndex: undefined,
        noOfUsers: 1,
        lastReadingTimeStamp: undefined,
        lastSequenceNumber: undefined,
        databaseUpdateFlag: undefined,
        databaseChangeIncrement: undefined,
        isDeviceDeleted: undefined,
        iOSIdentifier: undefined,
        isEagleDevice: undefined,
        deviceCategoryNum: data.devices.deviceCategoryNum,
      });
      logger.info({ event: 'device_registered', deviceId: deviceEntry.deviceId });

      // Publish event
      await publishEvent(
        {
          eventType: 'Device.Paired',
          userId: data.userId,
          organizationId: data.organizationId,
          deviceId: deviceEntry.deviceId,
          configDeviceId: data.devices.configDeviceId,
          timestamp: Date.now(),
        },
        correlationId,
      );

      // For non-third-party devices, trigger task completion
      if (!isThirdPartyApp(data.devices.deviceCategory)) {
        await completeUserTask(data.userId, data.organizationId, correlationId);
      }

      return { deviceId: deviceEntry.deviceId, configDeviceId: data.devices.configDeviceId };
    } catch (err) {
      logger.error({ event: 'service_registerDevice_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Delete a single device
   */
  async deleteDevice(userId: string, configDeviceId: string, correlationId?: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { correlationId, userId, configDeviceId });
    logger.info({ event: 'service_deleteDevice_start' });

    try {
      // Get device entry to get deviceId
      const deviceEntry = await this.deviceRepository.getDeviceByConfigId(userId, configDeviceId);
      if (!deviceEntry) {
        throw new DeviceNotFoundError(configDeviceId);
      }

      // Delete device
      await this.deviceRepository.deleteDevice(userId, configDeviceId);

      // Publish event
      await publishEvent(
        {
          eventType: 'Device.Deleted',
          userId,
          deviceId: deviceEntry.deviceId,
          configDeviceId,
          timestamp: Date.now(),
        },
        correlationId,
      );

      logger.info({ event: 'device_deleted', configDeviceId });
    } catch (err) {
      logger.error({ event: 'service_deleteDevice_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Delete multiple devices
   */
  async deleteMultipleDevices(userId: string, configDeviceIds: string[], correlationId?: string): Promise<Array<{ success: boolean; configDeviceId: string; errorKey?: string; errorCode?: string; message?: string }>> {
    const logger = createChildLogger(baseLogger, { correlationId, userId, count: configDeviceIds.length });
    logger.info({ event: 'service_deleteMultipleDevices_start' });

    const results = await Promise.allSettled(
      configDeviceIds.map(async (configDeviceId) => {
        try {
          await this.deleteDevice(userId, configDeviceId, correlationId);
          return { success: true, configDeviceId, message: 'Device deleted successfully' };
        } catch (err) {
          logger.warn({ event: 'delete_device_failed', configDeviceId, err: serializeError(err) });
          if (err instanceof DeviceNotFoundError) {
            return {
              success: false,
              configDeviceId,
              errorKey: 'DEVICE.DEVICE_NOT_FOUND',
              errorCode: 'DEVICE_NOT_FOUND',
              message: err.message,
            };
          }
          return {
            success: false,
            configDeviceId,
            errorKey: 'DEVICE.DELETE_FAILED',
            errorCode: 'DELETE_FAILED',
            message: (err as Error).message,
          };
        }
      }),
    );

    return results.map((result) => (result.status === 'fulfilled' ? result.value : { success: false, configDeviceId: '', errorCode: 'UNKNOWN_ERROR', message: 'Unknown error' }));
  }

  /**
   * Get user devices
   */
  async getUserDevices(userId: string, filters?: { deviceId?: string; deviceType?: string }): Promise<Device[]> {
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_getUserDevices_start' });

    try {
      const deviceEntries = await this.deviceRepository.getUserDevices(userId, filters);

      // Enrich with device images from global device list
      const devices = await Promise.all(
        deviceEntries.map(async (entry) => {
          const globalDevice = await this.globalDeviceRepository.getDeviceById(entry.configDeviceId);
          return {
            userId: entry.userId,
            deviceId: entry.deviceId,
            configDeviceId: entry.configDeviceId,
            macAddress: entry.macAddress,
            displayName: entry.displayName,
            deviceCategory: entry.deviceCategory,
            companyName: entry.companyName,
            modelName: entry.modelName,
            platform: entry.platform,
            isAutoSyncEnabled: entry.isAutoSyncEnabled,
            isAutoSyncSupported: entry.isAutoSyncSupported,
            isSync: entry.isSync,
            userIndex: entry.userIndex,
            noOfUsers: entry.noOfUsers,
            lastReadingTimeStamp: entry.lastReadingTimeStamp,
            usesExtensionProtocol: entry.usesExtensionProtocol,
            supportsUserAuthentication: entry.supportsUserAuthentication,
            autoSyncDelay: entry.autoSyncDelay,
            databaseUpdateFlag: entry.databaseUpdateFlag,
            databaseChangeIncrement: entry.databaseChangeIncrement,
            isDeviceDeleted: entry.isDeviceDeleted,
            iOSIdentifier: entry.iOSIdentifier,
            isEagleDevice: entry.isEagleDevice,
            deviceImage: globalDevice ? (globalDevice as any).deviceImage : undefined,
            deviceCategoryNum: entry.deviceCategoryNum ? parseInt(entry.deviceCategoryNum, 10) : undefined,
          } as Device;
        }),
      );

      logger.info({ event: 'service_getUserDevices_success', count: devices.length });
      return devices;
    } catch (err) {
      logger.error({ event: 'service_getUserDevices_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Update lastReadingTimeStamp for a device
   */
  async updateLastReadingTimeStamp(userId: string, configDeviceId: string, lastReadingTimeStamp: number, correlationId?: string): Promise<DeviceUserEntry> {
    const logger = createChildLogger(baseLogger, { correlationId, userId, configDeviceId });
    logger.info({ event: 'service_updateLastReadingTimeStamp_start' });

    try {
      const updatedDevice = await this.deviceRepository.updateLastReadingTimeStamp(userId, configDeviceId, lastReadingTimeStamp);
      logger.info({ event: 'service_updateLastReadingTimeStamp_success', configDeviceId, lastReadingTimeStamp });
      return updatedDevice;
    } catch (err) {
      logger.error({ event: 'service_updateLastReadingTimeStamp_error', err: serializeError(err) });
      throw err;
    }
  }
}
