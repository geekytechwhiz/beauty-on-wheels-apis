import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { OrgDevice } from '../models';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'org-device-repository' });

export class OrgDeviceRepository {
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
   * Create bidirectional organization-device mappings
   */
  async addOrgDevice(organizationId: string, device: { deviceId: string; category: string; name: string; enabled?: boolean; isAutoSyncSupported?: boolean }): Promise<void> {
    const logger = createChildLogger(baseLogger, { organizationId, deviceId: device.deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(device.deviceId);
    const now = Date.now();

    // Forward mapping: Organization → Device
    const forwardEntry: OrgDevice = {
      pk: `ORG_DEVICES#${organizationId}`,
      sk: normalizedDeviceId,
      sk1: device.category.toUpperCase().split(' ').join('_'),
      sk2: device.name.toUpperCase().split(' ').join('_'),
      sk3: `${device.category}#${device.name}`,
      organizationID: organizationId,
      enabled: device.enabled ?? true,
      isAutoSyncSupported: device.isAutoSyncSupported ?? true,
      name: device.name,
      category: device.category,
      deviceId: device.deviceId,
      createdDate: now,
      modifiedDate: now,
    };

    // Reverse mapping: Device → Organization
    const reverseEntry: OrgDevice = {
      pk: `ORG_DEVICES#${normalizedDeviceId}`,
      sk: organizationId,
      sk1: device.category.toUpperCase().split(' ').join('_'),
      sk2: device.name.toUpperCase().split(' ').join('_'),
      sk3: `${device.category}#${device.name}`,
      organizationID: organizationId,
      enabled: device.enabled ?? true,
      isAutoSyncSupported: device.isAutoSyncSupported ?? true,
      name: device.name,
      category: device.category,
      deviceId: device.deviceId,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await Promise.all([
        this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: forwardEntry,
          }),
        ),
        this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: reverseEntry,
          }),
        ),
      ]);
      logger.info({ event: 'org_device_added', deviceId: device.deviceId });
    } catch (err) {
      logger.error({ event: 'org_device_add_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Remove organization-device mappings (both forward and reverse)
   */
  async removeOrgDevice(organizationId: string, deviceId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { organizationId, deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);

    try {
      // Get the device entry to find category and name
      const deviceEntry = await this.getOrgDevice(organizationId, deviceId);
      if (!deviceEntry) {
        throw new DeviceNotFoundError(deviceId);
      }

      // Delete forward mapping
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: `ORG_DEVICES#${organizationId}`,
            sk: normalizedDeviceId,
          },
        }),
      );

      // Delete reverse mapping
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: `ORG_DEVICES#${normalizedDeviceId}`,
            sk: organizationId,
          },
        }),
      );

      logger.info({ event: 'org_device_removed', deviceId });
    } catch (err) {
      logger.error({ event: 'org_device_remove_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Update organization device settings
   */
  async updateOrgDevice(organizationId: string, deviceId: string, updates: { enabled?: boolean; isAutoSyncSupported?: boolean }): Promise<void> {
    const logger = createChildLogger(baseLogger, { organizationId, deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);

    const updateParts: string[] = ['modifiedDate = :modifiedDate'];
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': Date.now(),
    };

    if (updates.enabled !== undefined) {
      updateParts.push('enabled = :enabled');
      exprValues[':enabled'] = updates.enabled;
    }
    if (updates.isAutoSyncSupported !== undefined) {
      updateParts.push('isAutoSyncSupported = :isAutoSyncSupported');
      exprValues[':isAutoSyncSupported'] = updates.isAutoSyncSupported;
    }

    try {
      // Update forward mapping
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `ORG_DEVICES#${organizationId}`,
            sk: normalizedDeviceId,
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );

      // Update reverse mapping
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `ORG_DEVICES#${normalizedDeviceId}`,
            sk: organizationId,
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );

      logger.info({ event: 'org_device_updated', deviceId });
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new DeviceNotFoundError(deviceId);
      }
      logger.error({ event: 'org_device_update_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get organization devices
   */
  async getOrgDevices(organizationId: string): Promise<OrgDevice[]> {
    const logger = createChildLogger(baseLogger, { organizationId });
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': `ORG_DEVICES#${organizationId}`,
          },
        }),
      );
      logger.info({ event: 'get_org_devices_success', count: result.Items?.length || 0 });
      return (result.Items || []) as OrgDevice[];
    } catch (err) {
      logger.error({ event: 'get_org_devices_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get a specific organization device
   */
  async getOrgDevice(organizationId: string, deviceId: string): Promise<OrgDevice | null> {
    const logger = createChildLogger(baseLogger, { organizationId, deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `ORG_DEVICES#${organizationId}`,
            sk: normalizedDeviceId,
          },
        }),
      );
      return result.Item as OrgDevice | null;
    } catch (err) {
      logger.error({ event: 'get_org_device_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Check if device is available in organization
   */
  async isDeviceInOrganization(organizationId: string, deviceId: string): Promise<boolean> {
    const device = await this.getOrgDevice(organizationId, deviceId);
    return device !== null && device.enabled === true;
  }
}
