import { DeviceRepository } from '../repositories/deviceRepository';
import { OrgDeviceRepository } from '../repositories/orgDeviceRepository';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { RecommendationRepository } from '../repositories/recommendationRepository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { DeviceUserEntry, Device } from '../models';
import { DeviceNotFoundError, DeviceNotInOrganizationError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';
import { completeUserTask } from '../utils/task-completion';
import { isThirdPartyApp, isThirdPartyByCompanyName } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });

export type DeviceUserRegistrationItem =
  | { message: string; statusCode: number; configDeviceId: string; deviceId: string }
  | {
      statusCode: number;
      configDeviceId?: string;
      errorCode: string;
      success: false;
      message: Record<string, unknown> | string;
    };

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
   * Patient-app device user registration (legacy pairing): register or update devices with full payload.
   * Uses correct mapping to existing table: pk=DEVICE_LIST#userId, sk=DETAILS#configDeviceId, sk1=DEVICE#category, sk2=STATUS#ACTIVE.
   * For non-third-party devices (by companyName), validates device exists in global list and is enabled.
   * Updates RECOMMEND entry to PAIRED when present; invokes completeUserTask for real devices.
   */
  async registerOrUpdateDeviceUserFromPatientApp(
    payload: {
      userId: string;
      organizationId: string;
      devices: Array<{
        configDeviceId: string;
        displayName: string;
        noOfUsers: number;
        deviceCategory: string;
        companyName: string;
        modelName: string;
        usesExtensionProtocol: boolean;
        supportsUserAuthentication: boolean;
        platform: string;
        isAutoSyncEnabled: boolean;
        isAutoSyncSupported: boolean;
        autoSyncDelay: number;
        isSync: boolean;
        macAddress?: string;
        localName?: string;
        lastSequenceNumber?: string;
        lastReadingTimeStamp?: number;
        databaseUpdateFlag?: boolean;
        databaseChangeIncrement?: number;
        isDeviceDeleted?: boolean;
        iOSIdentifier?: string;
        userIndex?: number;
        isEagleDevice?: boolean;
        deviceCategoryNum?: string | number;
      }>;
    },
    correlationId?: string,
  ): Promise<{ items: DeviceUserRegistrationItem[] }> {
    const logger = createChildLogger(baseLogger, { correlationId, userId: payload.userId });
    logger.info({ event: 'registerOrUpdateDeviceUserFromPatientApp_start', deviceCount: payload.devices.length });

    const items: DeviceUserRegistrationItem[] = [];
    let anyRealDevice = false;

    for (const device of payload.devices) {
      try {
        const isThirdParty = isThirdPartyByCompanyName(device.companyName);
        if (!isThirdParty) {
          const globalDevice = await this.globalDeviceRepository.getDeviceById(device.configDeviceId);
          if (!globalDevice || globalDevice.enabled === false) {
            items.push({
              statusCode: 400,
              configDeviceId: device.configDeviceId,
              errorCode: 'DEVICE_NOT_AVAILABLE_TO_PAIR',
              success: false,
              message: { key: 'DEVICE.DEVICE_NOT_AVAILABLE_TO_PAIR' },
            });
            continue;
          }
          anyRealDevice = true;
        }

        const existing = await this.deviceRepository.getDeviceByConfigId(payload.userId, device.configDeviceId);
        const now = Date.now();

        if (existing && existing.sk2 === 'STATUS#ACTIVE') {
          await this.deviceRepository.updateDeviceUserEntry(
            payload.userId,
            device.configDeviceId,
            {
              macAddress: device.macAddress,
              displayName: device.displayName,
              noOfUsers: device.noOfUsers,
              databaseUpdateFlag: device.databaseUpdateFlag,
              deviceCategory: device.deviceCategory,
              lastSequenceNumber: device.lastSequenceNumber,
              localName: device.localName,
              companyName: device.companyName,
              modelName: device.modelName,
              usesExtensionProtocol: device.usesExtensionProtocol,
              supportsUserAuthentication: device.supportsUserAuthentication,
              lastReadingTimeStamp: device.lastReadingTimeStamp,
              databaseChangeIncrement: device.databaseChangeIncrement,
              isDeviceDeleted: device.isDeviceDeleted,
              platform: device.platform,
              isAutoSyncEnabled: device.isAutoSyncEnabled,
              iOSIdentifier: device.iOSIdentifier,
              isAutoSyncSupported: device.isAutoSyncSupported,
              autoSyncDelay: device.autoSyncDelay,
              userIndex: device.userIndex,
              isEagleDevice: device.isEagleDevice,
              isSync: device.isSync,
              deviceCategoryNum: device.deviceCategoryNum,
            },
            { updatedBy: payload.userId, updatedAt: now },
          );
          const rec = await this.recommendationRepository.getRecommendation(payload.userId, device.configDeviceId);
          if (rec) {
            await this.recommendationRepository.updateRecommendationStatus(payload.userId, device.configDeviceId, 'PAIRED');
          }
          items.push({
            message: 'Device updated successfully',
            statusCode: 201,
            configDeviceId: device.configDeviceId,
            deviceId: existing.deviceId,
          });
        } else {
          const entry = await this.deviceRepository.createDeviceUserEntryWithUpdates(
            {
              userId: payload.userId,
              configDeviceId: device.configDeviceId,
              displayName: device.displayName,
              deviceCategory: device.deviceCategory,
              companyName: device.companyName,
              modelName: device.modelName,
              platform: device.platform,
              noOfUsers: device.noOfUsers,
              usesExtensionProtocol: device.usesExtensionProtocol,
              supportsUserAuthentication: device.supportsUserAuthentication,
              isAutoSyncEnabled: device.isAutoSyncEnabled,
              isAutoSyncSupported: device.isAutoSyncSupported,
              isSync: device.isSync,
              autoSyncDelay: device.autoSyncDelay,
              macAddress: device.macAddress,
              localName: device.localName,
              lastSequenceNumber: device.lastSequenceNumber,
              lastReadingTimeStamp: device.lastReadingTimeStamp,
              databaseUpdateFlag: device.databaseUpdateFlag,
              databaseChangeIncrement: device.databaseChangeIncrement,
              isDeviceDeleted: device.isDeviceDeleted,
              iOSIdentifier: device.iOSIdentifier,
              userIndex: device.userIndex,
              isEagleDevice: device.isEagleDevice,
              deviceCategoryNum: device.deviceCategoryNum,
            },
            correlationId,
          );
          const rec = await this.recommendationRepository.getRecommendation(payload.userId, device.configDeviceId);
          if (rec) {
            await this.recommendationRepository.updateRecommendationStatus(payload.userId, device.configDeviceId, 'PAIRED');
          }
          items.push({
            message: 'Device successfully paired with the user',
            statusCode: 201,
            configDeviceId: device.configDeviceId,
            deviceId: entry.deviceId,
          });
        }
      } catch (err) {
        logger.error({ event: 'device_user_register_error', configDeviceId: device.configDeviceId, err: serializeError(err) });
        items.push({
          statusCode: 500,
          configDeviceId: device.configDeviceId,
          errorCode: 'REGISTRATION_FAILED',
          success: false,
          message: (err as Error).message,
        });
      }
    }

    if (anyRealDevice) {
      await completeUserTask(payload.userId, payload.organizationId, correlationId);
    }

    logger.info({ event: 'registerOrUpdateDeviceUserFromPatientApp_done', itemCount: items.length });
    return { items };
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
