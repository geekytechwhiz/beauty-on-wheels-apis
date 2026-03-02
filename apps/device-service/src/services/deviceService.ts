import { DeviceRepository } from '../repositories/deviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { RecommendationRepository } from '../repositories/recommendationRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { DeviceUserEntry, Device } from '../models';
import { DeviceNotFoundError, DeviceNotInOrganizationError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { isThirdPartyApp } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });

export class DeviceService {
  private deviceRepository: DeviceRepository;
  private orgDeviceRepository: OrgDeviceRepository;
  private globalDeviceRepository: GlobalDeviceRepository;
  private recommendationRepository: RecommendationRepository;

  constructor() {
    this.deviceRepository = new DeviceRepository();
    this.orgDeviceRepository = new OrgDeviceRepository();
    this.globalDeviceRepository = new GlobalDeviceRepository();
    this.recommendationRepository = new RecommendationRepository();
  }

  /**
   * Register/pair a device with a user (matches old structure behavior)
   * Supports both create and update with field merging
   */
  async registerDevice(
    data: {
      userId: string;
      organizationId: string;
      configDeviceId: string;
      displayName?: string;
      deviceCategory: string;
      companyName?: string;
      modelName?: string;
      platform?: string;
      macAddress?: string;
      localName?: string;
      isAutoSyncEnabled?: boolean;
      isAutoSyncSupported?: boolean;
      isSync?: boolean;
      usesExtensionProtocol?: boolean;
      supportsUserAuthentication?: boolean;
      autoSyncDelay?: number;
      userIndex?: number;
      noOfUsers?: number;
      lastReadingTimeStamp?: number;
      lastSequenceNumber?: string;
      databaseUpdateFlag?: boolean;
      databaseChangeIncrement?: number;
      isDeviceDeleted?: boolean;
      iOSIdentifier?: string;
      isEagleDevice?: boolean;
      deviceCategoryNum?: string;
      deviceId?: string;
    },
    correlationId?: string,
  ): Promise<{ deviceId: string; configDeviceId: string; isUpdate: boolean }> {
    const logger = createChildLogger(baseLogger, { correlationId, userId: data.userId, configDeviceId: data.configDeviceId });
    logger.info({ event: 'service_registerDevice_start' });

    try {
      // Check if device already exists
      const existing = await this.deviceRepository.getDeviceByConfigId(data.userId, data.configDeviceId);
      
      if (existing) {
        // Device exists - update with merge logic (preserve existing values if new ones are missing/empty)
        logger.info({ event: 'device_exists_updating', configDeviceId: data.configDeviceId });
        
        // Merge device data: use new value if provided and not empty string, otherwise use existing
        const mergedDevice = {
          deviceId: data.deviceId || existing.deviceId,
          configDeviceId: data.configDeviceId,
          macAddress: (data.macAddress !== undefined && data.macAddress !== '') ? data.macAddress : existing.macAddress,
          displayName: (data.displayName !== undefined && data.displayName !== '') ? data.displayName : existing.displayName,
          noOfUsers: data.noOfUsers !== undefined ? data.noOfUsers : existing.noOfUsers,
          databaseUpdateFlag: data.databaseUpdateFlag !== undefined ? data.databaseUpdateFlag : existing.databaseUpdateFlag,
          deviceCategory: (data.deviceCategory !== undefined && data.deviceCategory !== '') ? data.deviceCategory : existing.deviceCategory,
          lastSequenceNumber: data.lastSequenceNumber !== undefined ? data.lastSequenceNumber : existing.lastSequenceNumber,
          localName: (data.localName !== undefined && data.localName !== '') ? data.localName : existing.localName,
          companyName: (data.companyName !== undefined && data.companyName !== '') ? data.companyName : existing.companyName,
          modelName: (data.modelName !== undefined && data.modelName !== '') ? data.modelName : existing.modelName,
          usesExtensionProtocol: data.usesExtensionProtocol !== undefined ? data.usesExtensionProtocol : existing.usesExtensionProtocol,
          supportsUserAuthentication: data.supportsUserAuthentication !== undefined ? data.supportsUserAuthentication : existing.supportsUserAuthentication,
          lastReadingTimeStamp: data.lastReadingTimeStamp !== undefined ? data.lastReadingTimeStamp : existing.lastReadingTimeStamp,
          databaseChangeIncrement: data.databaseChangeIncrement !== undefined ? data.databaseChangeIncrement : existing.databaseChangeIncrement,
          isDeviceDeleted: data.isDeviceDeleted !== undefined ? data.isDeviceDeleted : existing.isDeviceDeleted,
          platform: (data.platform !== undefined && data.platform !== '') ? data.platform : existing.platform,
          isAutoSyncEnabled: data.isAutoSyncEnabled !== undefined ? data.isAutoSyncEnabled : existing.isAutoSyncEnabled,
          iOSIdentifier: (data.iOSIdentifier !== undefined && data.iOSIdentifier !== '') ? data.iOSIdentifier : existing.iOSIdentifier,
          isAutoSyncSupported: data.isAutoSyncSupported !== undefined ? data.isAutoSyncSupported : existing.isAutoSyncSupported,
          autoSyncDelay: data.autoSyncDelay !== undefined ? data.autoSyncDelay : existing.autoSyncDelay,
          userIndex: data.userIndex !== undefined ? data.userIndex : existing.userIndex,
          isEagleDevice: data.isEagleDevice !== undefined ? data.isEagleDevice : existing.isEagleDevice,
          isSync: data.isSync !== undefined ? data.isSync : existing.isSync,
          deviceCategoryNum: data.deviceCategoryNum !== undefined ? data.deviceCategoryNum : existing.deviceCategoryNum,
        };

        // Add update tracking
        const updates = existing.updates || [];
        updates.push({
          updatedBy: data.userId,
          updatedAt: Date.now(),
        });

        // Update device entry
        const updatedDevice = await this.deviceRepository.updateDeviceEntry(mergedDevice, data.userId, updates);

        // Check if device recommendation exists and update it
        const recommendation = await this.recommendationRepository.getRecommendation(data.userId, data.configDeviceId);
        if (recommendation) {
          await this.recommendationRepository.updateRecommendationStatus(data.userId, data.configDeviceId, 'PAIRED');
        }

        logger.info({ event: 'device_updated', deviceId: updatedDevice.deviceId });
        return { deviceId: updatedDevice.deviceId, configDeviceId: data.configDeviceId, isUpdate: true };
      } else {
        // Device doesn't exist - create new entry
        logger.info({ event: 'device_not_exists_creating', configDeviceId: data.configDeviceId });

        // For non-third-party devices, validate device is available in organization
        if (!isThirdPartyApp(data.deviceCategory)) {
          const isAvailable = await this.orgDeviceRepository.isDeviceInOrganization(data.organizationId, data.configDeviceId);
          if (!isAvailable) {
            // Try to get device from global device list
            const globalDevice = await this.globalDeviceRepository.getDeviceById(data.configDeviceId);
            if (!globalDevice || !globalDevice.enabled) {
              // throw new DeviceNotInOrganizationError(data.configDeviceId, data.organizationId);
              const deviceEntry = await this.deviceRepository.createDeviceUserEntry({
                userId: data.userId,
                configDeviceId: data.configDeviceId,
                displayName: data.displayName || '',
                deviceCategory: data.deviceCategory,
                companyName: data.companyName || '',
                modelName: data.modelName || '',
                platform: data.platform || '',
                macAddress: data.macAddress,
                localName: data.localName,
                isAutoSyncEnabled: data.isAutoSyncEnabled ?? false,
                isAutoSyncSupported: data.isAutoSyncSupported ?? false,
                isSync: data.isSync ?? false,
                usesExtensionProtocol: data.usesExtensionProtocol ?? false,
                supportsUserAuthentication: data.supportsUserAuthentication ?? false,
                autoSyncDelay: data.autoSyncDelay ?? 0,
                userIndex: data.userIndex,
                noOfUsers: data.noOfUsers ?? 1,
                lastReadingTimeStamp: data.lastReadingTimeStamp,
                lastSequenceNumber: data.lastSequenceNumber,
                databaseUpdateFlag: data.databaseUpdateFlag,
                databaseChangeIncrement: data.databaseChangeIncrement,
                isDeviceDeleted: data.isDeviceDeleted,
                iOSIdentifier: data.iOSIdentifier,
                isEagleDevice: data.isEagleDevice,
                deviceCategoryNum: data.deviceCategoryNum,
              });
              logger.info({ event: 'device_registered', deviceId: deviceEntry.deviceId });
            }
          }
        }

        // Create device user entry with provided values or defaults
        const deviceEntry = await this.deviceRepository.createDeviceUserEntry({
          userId: data.userId,
          configDeviceId: data.configDeviceId,
          displayName: data.displayName || '',
          deviceCategory: data.deviceCategory,
          companyName: data.companyName || '',
          modelName: data.modelName || '',
          platform: data.platform || '',
          macAddress: data.macAddress,
          localName: data.localName,
          isAutoSyncEnabled: data.isAutoSyncEnabled ?? false,
          isAutoSyncSupported: data.isAutoSyncSupported ?? false,
          isSync: data.isSync ?? false,
          usesExtensionProtocol: data.usesExtensionProtocol ?? false,
          supportsUserAuthentication: data.supportsUserAuthentication ?? false,
          autoSyncDelay: data.autoSyncDelay ?? 0,
          userIndex: data.userIndex,
          noOfUsers: data.noOfUsers ?? 1,
          lastReadingTimeStamp: data.lastReadingTimeStamp,
          lastSequenceNumber: data.lastSequenceNumber,
          databaseUpdateFlag: data.databaseUpdateFlag,
          databaseChangeIncrement: data.databaseChangeIncrement,
          isDeviceDeleted: data.isDeviceDeleted,
          iOSIdentifier: data.iOSIdentifier,
          isEagleDevice: data.isEagleDevice,
          deviceCategoryNum: data.deviceCategoryNum,
        });
        logger.info({ event: 'device_registered', deviceId: deviceEntry.deviceId });

        // Update device recommendation if it exists
        const recommendation = await this.recommendationRepository.getRecommendation(data.userId, data.configDeviceId);
        if (recommendation) {
          await this.recommendationRepository.updateRecommendationStatus(data.userId, data.configDeviceId, 'PAIRED');
        }

        // Publish event
        await publishEvent(
          {
            eventType: 'Device.Paired',
            userId: data.userId,
            organizationId: data.organizationId,
            deviceId: deviceEntry.deviceId,
            configDeviceId: data.configDeviceId,
            timestamp: Date.now(),
          },
          correlationId,
        );

        return { deviceId: deviceEntry.deviceId, configDeviceId: data.configDeviceId, isUpdate: false };
      }
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