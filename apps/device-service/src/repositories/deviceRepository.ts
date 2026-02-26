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
   * Update existing user-device entry (patient-app pairing) – full attribute merge and append updates
   */
  async updateDeviceUserEntry(
    userId: string,
    configDeviceId: string,
    device: {
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
      deviceCategoryNum?: string | number;
    },
    updateEntry: { updatedBy: string; updatedAt: number },
  ): Promise<DeviceUserEntry> {
    const logger = createChildLogger(baseLogger, { userId, configDeviceId });
    const existing = await this.getDeviceByConfigId(userId, configDeviceId);
    if (!existing) {
      throw new DeviceNotFoundError(configDeviceId);
    }

    const existingUpdates = existing.updates || [];
    const newUpdates = [...existingUpdates, updateEntry];

    const deviceCategoryNum =
      device.deviceCategoryNum !== undefined
        ? typeof device.deviceCategoryNum === 'number'
          ? String(device.deviceCategoryNum)
          : device.deviceCategoryNum
        : undefined;

    const setParts: string[] = [
      'modifiedDate = :modifiedDate',
      '#sk2 = :sk2',
      '#updates = :updates',
      'macAddress = :macAddress',
      'displayName = :displayName',
      'noOfUsers = :noOfUsers',
      'databaseUpdateFlag = :databaseUpdateFlag',
      'deviceCategory = :deviceCategory',
      'lastSequenceNumber = :lastSequenceNumber',
      'localName = :localName',
      'companyName = :companyName',
      'modelName = :modelName',
      'usesExtensionProtocol = :usesExtensionProtocol',
      'supportsUserAuthentication = :supportsUserAuthentication',
      'lastReadingTimeStamp = :lastReadingTimeStamp',
      'databaseChangeIncrement = :databaseChangeIncrement',
      'isDeviceDeleted = :isDeviceDeleted',
      'platform = :platform',
      'isAutoSyncEnabled = :isAutoSyncEnabled',
      'iOSIdentifier = :iOSIdentifier',
      'isAutoSyncSupported = :isAutoSyncSupported',
      'autoSyncDelay = :autoSyncDelay',
      'userIndex = :userIndex',
      'isEagleDevice = :isEagleDevice',
      'isSync = :isSync',
      'deviceCategoryNum = :deviceCategoryNum',
    ];

    const exprValues: Record<string, unknown> = {
      ':modifiedDate': updateEntry.updatedAt,
      ':sk2': 'STATUS#ACTIVE',
      ':updates': newUpdates,
      ':macAddress': device.macAddress ?? existing.macAddress ?? '',
      ':displayName': device.displayName ?? existing.displayName ?? '',
      ':noOfUsers': device.noOfUsers ?? existing.noOfUsers ?? 0,
      ':databaseUpdateFlag': device.databaseUpdateFlag ?? existing.databaseUpdateFlag ?? false,
      ':deviceCategory': device.deviceCategory ?? existing.deviceCategory ?? '',
      ':lastSequenceNumber': device.lastSequenceNumber ?? existing.lastSequenceNumber ?? '',
      ':localName': device.localName ?? existing.localName ?? '',
      ':companyName': device.companyName ?? existing.companyName ?? '',
      ':modelName': device.modelName ?? existing.modelName ?? '',
      ':usesExtensionProtocol': device.usesExtensionProtocol ?? existing.usesExtensionProtocol ?? false,
      ':supportsUserAuthentication': device.supportsUserAuthentication ?? existing.supportsUserAuthentication ?? false,
      ':lastReadingTimeStamp': device.lastReadingTimeStamp ?? existing.lastReadingTimeStamp ?? 0,
      ':databaseChangeIncrement': device.databaseChangeIncrement ?? existing.databaseChangeIncrement ?? 0,
      ':isDeviceDeleted': device.isDeviceDeleted ?? existing.isDeviceDeleted ?? false,
      ':platform': device.platform ?? existing.platform ?? '',
      ':isAutoSyncEnabled': device.isAutoSyncEnabled ?? existing.isAutoSyncEnabled ?? false,
      ':iOSIdentifier': device.iOSIdentifier ?? existing.iOSIdentifier ?? '',
      ':isAutoSyncSupported': device.isAutoSyncSupported ?? existing.isAutoSyncSupported ?? false,
      ':autoSyncDelay': device.autoSyncDelay ?? existing.autoSyncDelay ?? 0,
      ':userIndex': device.userIndex ?? existing.userIndex ?? 0,
      ':isEagleDevice': device.isEagleDevice ?? existing.isEagleDevice ?? false,
      ':isSync': device.isSync ?? existing.isSync ?? false,
      ':deviceCategoryNum': deviceCategoryNum ?? existing.deviceCategoryNum ?? '',
    };

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE_LIST#${userId}`,
            sk: `DETAILS#${configDeviceId}`,
          },
          UpdateExpression: `SET ${setParts.join(', ')}`,
          ExpressionAttributeNames: {
            '#sk2': 'sk2',
            '#updates': 'updates',
          },
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const updated = await this.getDeviceByConfigId(userId, configDeviceId);
      logger.info({ event: 'device_user_entry_updated', configDeviceId });
      return updated!;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(configDeviceId);
      }
      logger.error({ event: 'device_user_entry_update_error', err: serializeError(err) });
      throw err;
    }
  }
}
