import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {  GlobalDevice, OrganizationDevice } from '../models';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';
import { DeviceNotFoundError, DeviceAlreadyDeletedError } from '../utils/errors';

const baseLogger = createLogger({ service: 'global-device-repository' });

export class GlobalDeviceRepository {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    this.docClient = ddbDocClient;
    this.tableName = process.env.DEVICE_TABLE || '';
  }

  /**
   * Normalize deviceId for use in keys (uppercase, replace spaces with underscores)
   */
  private normalizeDeviceId(deviceId: string): string {
    return deviceId?.toUpperCase()?.split(' ')?.join('_');
  }

  /**
   * Create a global device entry
   * Access Pattern:
   * pk: DEVICE_LIST
   * sk: CATEGORY#${category}#${deviceId}
   * sk3: ${deviceId?.toUpperCase()?.split(' ')?.join('_')}
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
      if (!this.tableName) {
        const error = new Error('Table name is not configured. Please set DEVICE_TABLE environment variable.');
        logger.error({ event: 'global_device_create_error', err: serializeError(error), tableName: this.tableName });
        throw error;
      }

      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }),
      );
      logger.info({ event: 'global_device_created', deviceId: data.deviceId, tableName: this.tableName });
      return item;
    } catch (err) {
      logger.error({ event: 'global_device_create_error', err: serializeError(err), tableName: this.tableName, deviceId: data.deviceId });
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


  async getDevicesByOrganization(organizationId: string): Promise<OrganizationDevice[]> {
    const logger = createChildLogger(baseLogger, { organizationId });

    const normalizedpk = organizationId.toUpperCase() === 'ROOT' ? 'DEVICE_LIST' : `ORG_DEVICES#${organizationId}`;
 
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': normalizedpk,
          },
        }),
      );
      return result.Items && result.Items.length > 0 ? (result.Items as OrganizationDevice[]) : [];
    } catch (err) {
      logger.error({ event: 'get_devices_by_organization_error', err: serializeError(err) });
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
      // If table doesn't exist (ResourceNotFoundException), treat as device not found
      // This allows the creation flow to proceed
      const error = err as { name?: string };
      if (error?.name === 'ResourceNotFoundException') {
        logger.warn({ 
          event: 'get_device_by_id_table_not_found', 
          deviceId, 
          tableName: this.tableName,
          message: 'Table does not exist, treating as device not found'
        });
        return null;
      }
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

  /**
   * Soft delete a global device by setting enabled to false
   * Access Pattern: Uses pk and sk from the device entry
   * Returns the deleted device information
   */
  async softDeleteDevice(deviceId: string): Promise<GlobalDevice> {
    const logger = createChildLogger(baseLogger, { deviceId });
    
    try {
      // First, get the device to find its category and construct the key
      const device = await this.getDeviceById(deviceId);
      if (!device) {
        throw new DeviceNotFoundError(deviceId);
      }

      // Check if device is already deleted
      if (device.enabled === false) {
        throw new DeviceAlreadyDeletedError(deviceId);
      }

      // Update the device to set enabled: false
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: device.pk,
            sk: device.sk,
          },
          UpdateExpression: 'SET enabled = :enabled',
          ExpressionAttributeValues: {
            ':enabled': false,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );

      // Return the device with updated enabled status
      const deletedDevice: GlobalDevice = {
        ...device,
        enabled: false,
      };

      logger.info({ event: 'global_device_soft_deleted', deviceId });
      return deletedDevice;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(deviceId);
      }
      if (err instanceof DeviceNotFoundError || err instanceof DeviceAlreadyDeletedError) {
        throw err;
      }
      logger.error({ event: 'global_device_soft_delete_error', err: serializeError(err), deviceId });
      throw err;
    }
  }

  /**
   * Update a global device
   * Access Pattern: Uses pk and sk from the device entry
   * Returns the updated device information
   * Note: pk, sk, sk3, sk4, and deviceId cannot be updated
   * 
   * This method performs a PARTIAL UPDATE - only the fields provided in the 'updates' parameter
   * will be updated. All other fields will remain unchanged (preserve their existing values).
   */
  async updateGlobalDevice(deviceId: string, updates: Partial<Omit<GlobalDevice, 'pk' | 'sk' | 'sk3' | 'sk4' | 'deviceId'>>): Promise<GlobalDevice> {
    const logger = createChildLogger(baseLogger, { deviceId });
    
    try {
      // First, get the device to check if it exists and get its keys
      const existingDevice = await this.getDeviceById(deviceId);
      if (!existingDevice) {
        throw new DeviceNotFoundError(deviceId);
      }

      // Check if category is being updated - if so, we need to delete and recreate the item
      // because DynamoDB doesn't allow updating sort key (sk) directly
      if (updates.category && typeof updates.category === 'string' && updates.category !== existingDevice.category) {
        // Category change requires delete + create pattern
        const normalizedCategory = updates.category.toUpperCase();
        const normalizedDeviceId = this.normalizeDeviceId(deviceId);
        const newSk = `CATEGORY#${updates.category}#${deviceId}`;
        
        // Create new device with updated category and all other updates
        const updatedDeviceData: GlobalDevice = {
          ...existingDevice,
          ...updates,
          category: updates.category,
          sk: newSk,
          sk3: normalizedDeviceId,
          sk4: normalizedCategory,
          modifiedDate: Date.now(),
        };

        // Delete old item
        await this.docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              pk: existingDevice.pk,
              sk: existingDevice.sk,
            },
            ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
          }),
        );

        // Create new item with updated keys
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: updatedDeviceData,
          }),
        );

        logger.info({ event: 'global_device_updated_with_category_change', deviceId, oldCategory: existingDevice.category, newCategory: updates.category });
        return updatedDeviceData;
      }

      // Build update expression dynamically for non-category updates
      const updateParts: string[] = [];
      const expressionAttributeValues: Record<string, unknown> = {};
      const expressionAttributeNames: Record<string, string> = {};

      // Handle other fields (excluding keys and deviceId and category)
      const excludedKeys = ['pk', 'sk', 'sk3', 'sk4', 'deviceId', 'category'];
      for (const [key, value] of Object.entries(updates)) {
        if (!excludedKeys.includes(key) && value !== undefined) {
          const attrName = `#${key}`;
          const attrValue = `:${key}`;
          updateParts.push(`${attrName} = ${attrValue}`);
          expressionAttributeNames[attrName] = key;
          expressionAttributeValues[attrValue] = value;
        }
      }

      if (updateParts.length === 0) {
        // No updates provided, return existing device
        logger.info({ event: 'global_device_update_no_changes', deviceId });
        return existingDevice;
      }

      // Add modifiedDate if not provided
      if (!updates.modifiedDate) {
        updateParts.push('modifiedDate = :modifiedDate');
        expressionAttributeValues[':modifiedDate'] = Date.now();
      }

      // Perform the update
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: existingDevice.pk,
            sk: existingDevice.sk,
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );

      // Get the updated device
      const updatedDevice = await this.getDeviceById(deviceId);
      if (!updatedDevice) {
        throw new DeviceNotFoundError(deviceId);
      }

      logger.info({ event: 'global_device_updated', deviceId });
      return updatedDevice;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(deviceId);
      }
      if (err instanceof DeviceNotFoundError) {
        throw err;
      }
      logger.error({ event: 'global_device_update_error', err: serializeError(err), deviceId });
      throw err;
    }
  }
}
