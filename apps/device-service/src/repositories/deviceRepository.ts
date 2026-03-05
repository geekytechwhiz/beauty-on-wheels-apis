import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DeviceUserEntry, Device } from '../models';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { DeviceNotFoundError } from '../utils/errors';
import * as crypto from 'crypto';

const baseLogger = createLogger({ service: 'device-repository' });

export class DeviceRepository {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    this.docClient = ddbDocClient;
    this.tableName = process.env.DEVICE_TABLE || '';
  }

  /**
   * Generate deviceId as SHA256 hash of userId-configDeviceId
   */
  private generateDeviceId(userId: string, configDeviceId: string): string {
    return crypto.createHash('sha256').update(`${userId}-${configDeviceId}`).digest('hex');
  }

  /**
   * Normalize deviceId for use in keys (uppercase, replace spaces with underscores)
   */
  private normalizeDeviceId(deviceId: string): string {
    return deviceId.toUpperCase().split(' ').join('_');
  }

  /**
   * Create a user-device entry
   */
  async createDeviceUserEntry(data: {
    userId: string;
    configDeviceId: string;
    displayName: string;
    deviceCategory: string;
    companyName: string;
    modelName: string;
    platform: string;
    macAddress?: string;
    localName?: string;
    isAutoSyncEnabled: boolean;
    isAutoSyncSupported: boolean;
    isSync: boolean;
    usesExtensionProtocol: boolean;
    supportsUserAuthentication: boolean;
    autoSyncDelay: number;
    userIndex?: number;
    noOfUsers: number;
    lastReadingTimeStamp?: number;
    lastSequenceNumber?: string;
    databaseUpdateFlag?: boolean;
    databaseChangeIncrement?: number;
    isDeviceDeleted?: boolean;
    iOSIdentifier?: string;
    isEagleDevice?: boolean;
    deviceCategoryNum?: string;
  }): Promise<DeviceUserEntry> {
    const logger = createChildLogger(baseLogger, { userId: data.userId, configDeviceId: data.configDeviceId });
    const deviceId = this.generateDeviceId(data.userId, data.configDeviceId);
    const now = Date.now();

    const item: DeviceUserEntry = {
      pk: `DEVICE_LIST#${data.userId}`,
      sk: `DETAILS#${data.configDeviceId}`,
      sk1: `DEVICE#${data.deviceCategory}`,
      sk2: 'STATUS#ACTIVE',
      userId: data.userId,
      deviceId,
      configDeviceId: data.configDeviceId,
      macAddress: data.macAddress,
      displayName: data.displayName,
      deviceCategory: data.deviceCategory,
      companyName: data.companyName,
      modelName: data.modelName,
      platform: data.platform,
      isAutoSyncEnabled: data.isAutoSyncEnabled,
      isAutoSyncSupported: data.isAutoSyncSupported,
      isSync: data.isSync,
      userIndex: data.userIndex,
      noOfUsers: data.noOfUsers,
      lastReadingTimeStamp: data.lastReadingTimeStamp,
      lastSequenceNumber: data.lastSequenceNumber,
      localName: data.localName,
      usesExtensionProtocol: data.usesExtensionProtocol,
      supportsUserAuthentication: data.supportsUserAuthentication,
      databaseUpdateFlag: data.databaseUpdateFlag,
      databaseChangeIncrement: data.databaseChangeIncrement,
      isDeviceDeleted: data.isDeviceDeleted,
      iOSIdentifier: data.iOSIdentifier,
      autoSyncDelay: data.autoSyncDelay,
      isEagleDevice: data.isEagleDevice,
      deviceCategoryNum: data.deviceCategoryNum,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }),
      );
      logger.info({ event: 'device_user_entry_created', deviceId });
      return item;
    } catch (err) {
      logger.error({ event: 'device_user_entry_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Create device user entry with updates array (patient-app pairing legacy mapping)
   */
  async createDeviceUserEntryWithUpdates(
    data: {
      userId: string;
      configDeviceId: string;
      displayName: string;
      deviceCategory: string;
      companyName: string;
      modelName: string;
      platform: string;
      noOfUsers: number;
      usesExtensionProtocol: boolean;
      supportsUserAuthentication: boolean;
      isAutoSyncEnabled: boolean;
      isAutoSyncSupported: boolean;
      isSync: boolean;
      autoSyncDelay: number;
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
    },
    correlationId?: string,
  ): Promise<DeviceUserEntry> {
    const logger = createChildLogger(baseLogger, { userId: data.userId, configDeviceId: data.configDeviceId, correlationId });
    const deviceId = this.generateDeviceId(data.userId, data.configDeviceId);
    const now = Date.now();
    const updates = [{ updatedBy: data.userId, updatedAt: now }];

    const deviceCategoryNum =
      data.deviceCategoryNum !== undefined
        ? typeof data.deviceCategoryNum === 'number'
          ? String(data.deviceCategoryNum)
          : data.deviceCategoryNum
        : undefined;

    const item: DeviceUserEntry = {
      pk: `DEVICE_LIST#${data.userId}`,
      sk: `DETAILS#${data.configDeviceId}`,
      sk1: `DEVICE#${data.deviceCategory}`,
      sk2: 'STATUS#ACTIVE',
      userId: data.userId,
      deviceId,
      configDeviceId: data.configDeviceId,
      macAddress: data.macAddress ?? '',
      displayName: data.displayName,
      deviceCategory: data.deviceCategory,
      companyName: data.companyName,
      modelName: data.modelName,
      platform: data.platform ?? '',
      isAutoSyncEnabled: data.isAutoSyncEnabled,
      isAutoSyncSupported: data.isAutoSyncSupported,
      isSync: data.isSync,
      userIndex: data.userIndex,
      noOfUsers: data.noOfUsers,
      lastReadingTimeStamp: data.lastReadingTimeStamp,
      lastSequenceNumber: data.lastSequenceNumber,
      localName: data.localName ?? '',
      usesExtensionProtocol: data.usesExtensionProtocol,
      supportsUserAuthentication: data.supportsUserAuthentication,
      databaseUpdateFlag: data.databaseUpdateFlag,
      databaseChangeIncrement: data.databaseChangeIncrement,
      isDeviceDeleted: data.isDeviceDeleted,
      iOSIdentifier: data.iOSIdentifier ?? '',
      autoSyncDelay: data.autoSyncDelay,
      isEagleDevice: data.isEagleDevice,
      deviceCategoryNum,
      updates,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }),
      );
      logger.info({ event: 'device_user_entry_created', deviceId });
      return item;
    } catch (err) {
      logger.error({ event: 'device_user_entry_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get device by configDeviceId for a user
   */
  async getDeviceByConfigId(userId: string, configDeviceId: string): Promise<DeviceUserEntry | null> {
    const logger = createChildLogger(baseLogger, { userId, configDeviceId });
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE_LIST#${userId}`,
            sk: `DETAILS#${configDeviceId}`,
          },
        }),
      );
      return result.Item as DeviceUserEntry | null;
    } catch (err) {
      logger.error({ event: 'get_device_by_config_id_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get all devices for a user
   */
  async getUserDevices(userId: string, filters?: { deviceId?: string; deviceType?: string }): Promise<DeviceUserEntry[]> {
    const logger = createChildLogger(baseLogger, { userId });
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': `DEVICE_LIST#${userId}`,
            ':status': 'STATUS#ACTIVE',
          },
          FilterExpression: 'sk2 = :status',
        }),
      );

      let devices = (result.Items || []) as DeviceUserEntry[];

      // Apply additional filters
      if (filters?.deviceId) {
        devices = devices.filter((d) => d.deviceId === filters.deviceId);
      }
      if (filters?.deviceType) {
        devices = devices.filter((d) => d.deviceCategory === filters.deviceType);
      }

      logger.info({ event: 'get_user_devices_success', count: devices.length });
      return devices;
    } catch (err) {
      logger.error({ event: 'get_user_devices_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Update device status to inactive (soft delete)
   */
  async deleteDevice(userId: string, configDeviceId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId, configDeviceId });
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE_LIST#${userId}`,
            sk: `DETAILS#${configDeviceId}`,
          },
          UpdateExpression: 'SET sk2 = :status, modifiedDate = :modifiedDate, isDeviceDeleted = :isDeleted',
          ExpressionAttributeValues: {
            ':status': 'STATUS#INACTIVE',
            ':modifiedDate': Date.now(),
            ':isDeleted': true,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      logger.info({ event: 'device_deleted', configDeviceId });
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(configDeviceId);
      }
      logger.error({ event: 'device_delete_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Delete multiple devices
   */
  async deleteMultipleDevices(userId: string, configDeviceIds: string[]): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId, count: configDeviceIds.length });

    try {
      // Delete each device individually to ensure proper status update
      await Promise.all(
        configDeviceIds.map((configDeviceId) => this.deleteDevice(userId, configDeviceId)),
      );

      logger.info({ event: 'multiple_devices_deleted', count: configDeviceIds.length });
    } catch (err) {
      logger.error({ event: 'multiple_devices_delete_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get device by deviceId (requires querying all user devices)
   */
  async getDeviceByDeviceId(userId: string, deviceId: string): Promise<DeviceUserEntry | null> {
    const devices = await this.getUserDevices(userId, { deviceId });
    return devices.length > 0 ? devices[0] : null;
  }

  /**
   * Update lastReadingTimeStamp for a user-device entry
   */
  async updateLastReadingTimeStamp(userId: string, configDeviceId: string, lastReadingTimeStamp: number): Promise<DeviceUserEntry> {
    const logger = createChildLogger(baseLogger, { userId, configDeviceId });
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE_LIST#${userId}`,
            sk: `DETAILS#${configDeviceId}`,
          },
          UpdateExpression: 'SET lastReadingTimeStamp = :lastReadingTimeStamp, modifiedDate = :modifiedDate',
          ExpressionAttributeValues: {
            ':lastReadingTimeStamp': lastReadingTimeStamp,
            ':modifiedDate': Date.now(),
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      // Fetch the updated device entry
      const updatedDevice = await this.getDeviceByConfigId(userId, configDeviceId);
      if (!updatedDevice) {
        throw new DeviceNotFoundError(configDeviceId);
      }

      logger.info({ event: 'last_reading_timestamp_updated', configDeviceId, lastReadingTimeStamp });
      return updatedDevice;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(configDeviceId);
      }
      logger.error({ event: 'update_last_reading_timestamp_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Update device entry with field merging logic (preserves existing values if new ones are missing/empty)
   */
  async updateDeviceEntry(
    device: {
      deviceId?: string;
      configDeviceId: string;
      macAddress?: string;
      displayName?: string;
      noOfUsers?: number;
      databaseUpdateFlag?: boolean;
      deviceCategory?: string;
      lastSequenceNumber?: string;
      localName?: string;
      companyName?: string;
      modelName?: string;
      usesExtensionProtocol?: boolean;
      supportsUserAuthentication?: boolean;
      lastReadingTimeStamp?: number;
      databaseChangeIncrement?: number;
      isDeviceDeleted?: boolean;
      platform?: string;
      isAutoSyncEnabled?: boolean;
      iOSIdentifier?: string;
      isAutoSyncSupported?: boolean;
      autoSyncDelay?: number;
      userIndex?: number;
      isEagleDevice?: boolean;
      isSync?: boolean;
      deviceCategoryNum?: string;
    },
    userId: string,
    updates: Array<{ updatedBy: string; updatedAt: number }>,
  ): Promise<DeviceUserEntry> {
    const logger = createChildLogger(baseLogger, { userId, configDeviceId: device.configDeviceId });
    try {
      const now = Date.now();
      const params: any = {
        TableName: this.tableName,
        Key: {
          pk: `DEVICE_LIST#${userId}`,
          sk: `DETAILS#${device.configDeviceId}`,
        },
        UpdateExpression: 'SET #modifiedDate = :modifiedDate, #sk2 = :sk2, #updates = list_append(if_not_exists(#updates, :emptyList), :updates)',
        ExpressionAttributeValues: {
          ':modifiedDate': now,
          ':sk2': 'STATUS#ACTIVE',
          ':updates': updates,
          ':emptyList': [],
        },
        ExpressionAttributeNames: {
          '#modifiedDate': 'modifiedDate',
          '#sk2': 'sk2',
          '#updates': 'updates',
        },
        ReturnValues: 'ALL_NEW',
      };

      // Helper to add attribute to update expression
      const addAttribute = (attrName: string, attrValue: any) => {
        params.UpdateExpression += `, #${attrName} = :${attrName}`;
        params.ExpressionAttributeValues[`:${attrName}`] = attrValue !== undefined ? attrValue : '';
        params.ExpressionAttributeNames[`#${attrName}`] = attrName;
      };

      const addBooleanAttribute = (attrName: string, attrValue: any) => {
        params.UpdateExpression += `, #${attrName} = :${attrName}`;
        params.ExpressionAttributeValues[`:${attrName}`] = attrValue !== undefined ? attrValue : false;
        params.ExpressionAttributeNames[`#${attrName}`] = attrName;
      };

      const addNumberAttribute = (attrName: string, attrValue: any) => {
        params.UpdateExpression += `, #${attrName} = :${attrName}`;
        params.ExpressionAttributeValues[`:${attrName}`] = attrValue !== undefined ? attrValue : 0;
        params.ExpressionAttributeNames[`#${attrName}`] = attrName;
      };

      // Add all device fields to update expression
      if (device.deviceId !== undefined) {
        addAttribute('deviceId', device.deviceId);
      }
      addAttribute('macAddress', device.macAddress);
      addAttribute('displayName', device.displayName);
      addNumberAttribute('noOfUsers', device.noOfUsers);
      addBooleanAttribute('databaseUpdateFlag', device.databaseUpdateFlag);
      addAttribute('deviceCategory', device.deviceCategory);
      addAttribute('lastSequenceNumber', device.lastSequenceNumber);
      addAttribute('localName', device.localName);
      addAttribute('companyName', device.companyName);
      addAttribute('modelName', device.modelName);
      addBooleanAttribute('usesExtensionProtocol', device.usesExtensionProtocol);
      addBooleanAttribute('supportsUserAuthentication', device.supportsUserAuthentication);
      addNumberAttribute('userIndex', device.userIndex);
      addAttribute('lastReadingTimeStamp', device.lastReadingTimeStamp);
      addNumberAttribute('databaseChangeIncrement', device.databaseChangeIncrement);
      addBooleanAttribute('isDeviceDeleted', device.isDeviceDeleted);
      addAttribute('platform', device.platform);
      addBooleanAttribute('isAutoSyncEnabled', device.isAutoSyncEnabled);
      addBooleanAttribute('isAutoSyncSupported', device.isAutoSyncSupported);
      addAttribute('iOSIdentifier', device.iOSIdentifier);
      addNumberAttribute('autoSyncDelay', device.autoSyncDelay);
      addBooleanAttribute('isEagleDevice', device.isEagleDevice);
      addBooleanAttribute('isSync', device.isSync);
      addAttribute('deviceCategoryNum', device.deviceCategoryNum);

      await this.docClient.send(new UpdateCommand(params));

      // Fetch the updated device entry
      const updatedDevice = await this.getDeviceByConfigId(userId, device.configDeviceId);
      if (!updatedDevice) {
        throw new DeviceNotFoundError(device.configDeviceId);
      }

      logger.info({ event: 'device_entry_updated', configDeviceId: device.configDeviceId });
      return updatedDevice;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(device.configDeviceId);
      }
      logger.error({ event: 'device_entry_update_error', err: serializeError(err) });
      throw err;
    }
  }
}
