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
    this.tableName = process.env.USER_TABLE || '';
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
}
