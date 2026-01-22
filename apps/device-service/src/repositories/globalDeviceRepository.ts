import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { GlobalDevice } from '../models';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'global-device-repository' });

export class GlobalDeviceRepository {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    this.docClient = ddbDocClient;
    this.tableName = process.env.USER_TABLE || '';
  }

  /**
   * Normalize deviceId for use in keys (uppercase, replace spaces with underscores)
   */
  private normalizeDeviceId(deviceId: string): string {
    return deviceId.toUpperCase().split(' ').join('_');
  }

  /**
   * Create a global device entry
   * Access Pattern:
   * pk: DEVICE_LIST
   * sk: CATEGORY#${category}#${deviceId}
   * sk3: ${deviceId.toUpperCase().split(' ').join('_')}
   * sk4: ${category.toUpperCase()}
   */
  async createGlobalDevice(data: {
    deviceId: string;
    category: string;
    name: string;
    enabled?: boolean;
    countriesSupported?: string[];
    [key: string]: unknown;
  }): Promise<GlobalDevice> {
    const logger = createChildLogger(baseLogger, { deviceId: data.deviceId, category: data.category });
    const normalizedDeviceId = this.normalizeDeviceId(data.deviceId);
    const normalizedCategory = data.category.toUpperCase();

    const item: GlobalDevice = {
      pk: 'DEVICE_LIST',
      sk: `CATEGORY#${data.category}#${data.deviceId}`,
      sk3: normalizedDeviceId,
      sk4: normalizedCategory,
      enabled: data.enabled !== undefined ? data.enabled : true,
      category: data.category,
      name: data.name,
      deviceId: data.deviceId,
      countriesSupported: data.countriesSupported || [],
      ...Object.fromEntries(Object.entries(data).filter(([key]) => !['deviceId', 'category', 'name', 'enabled', 'countriesSupported'].includes(key))),
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }),
      );
      logger.info({ event: 'global_device_created', deviceId: data.deviceId });
      return item;
    } catch (err) {
      logger.error({ event: 'global_device_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get all devices by category
   */
  async getDevicesByCategory(category?: string, countryCode?: string): Promise<GlobalDevice[]> {
    const logger = createChildLogger(baseLogger, { category, countryCode });
    try {
      let result;
      if (category) {
        // Query by category using sk4 index
        result = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'pk = :pk AND sk4 = :sk4',
            ExpressionAttributeValues: {
              ':pk': 'DEVICE_LIST',
              ':sk4': category.toUpperCase(),
            },
          }),
        );
      } else {
        // Get all devices
        result = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: {
              ':pk': 'DEVICE_LIST',
            },
          }),
        );
      }

      let devices = (result.Items || []) as GlobalDevice[];

      // Filter by country code if provided
      if (countryCode && devices.length > 0) {
        devices = devices.filter((device) => {
          const countries = device.countriesSupported || [];
          return countries.length === 0 || countries.includes(countryCode);
        });
      }

      logger.info({ event: 'get_devices_by_category_success', count: devices.length });
      return devices;
    } catch (err) {
      logger.error({ event: 'get_devices_by_category_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get device by deviceId
   * Note: sk3 is not a key attribute, so we query by pk and filter by sk3
   */
  async getDeviceById(deviceId: string): Promise<GlobalDevice | null> {
    const logger = createChildLogger(baseLogger, { deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'sk3 = :sk3',
          ExpressionAttributeValues: {
            ':pk': 'DEVICE_LIST',
            ':sk3': normalizedDeviceId,
          },
        }),
      );
      return result.Items && result.Items.length > 0 ? (result.Items[0] as GlobalDevice) : null;
    } catch (err) {
      logger.error({ event: 'get_device_by_id_error', err: serializeError(err), tableName: this.tableName });
      throw err;
    }
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const logger = createChildLogger(baseLogger, {});
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': 'DEVICE_LIST',
          },
        }),
      );

      const categories = new Set<string>();
      (result.Items || []).forEach((item) => {
        const device = item as GlobalDevice;
        if (device.category) {
          categories.add(device.category);
        }
      });

      logger.info({ event: 'get_categories_success', count: categories.size });
      return Array.from(categories);
    } catch (err) {
      logger.error({ event: 'get_categories_error', err: serializeError(err) });
      throw err;
    }
  }
}
