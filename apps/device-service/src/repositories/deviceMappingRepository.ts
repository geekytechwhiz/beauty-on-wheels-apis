import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'device-mapping-repository' });

export interface DeviceUserMapping {
  pk: string; // DEVICE#{deviceId}
  sk: string; // DEVICE_USER#{userId}
  userId: string;
  deviceId: string;
  createdDate: number;
  modifiedDate: number;
}

export interface DeviceOrgMapping {
  pk: string; // DEVICE#{deviceId}
  sk: string; // DEVICE_ORG#{orgId}
  organizationId: string;
  deviceId: string;
  createdDate: number;
  modifiedDate: number;
}

export interface DeviceMetadata {
  pk: string; // DEVICE#{deviceId}
  sk: string; // DEVICE_METADATA
  deviceId: string;
  metadata: Record<string, unknown>;
  createdDate: number;
  modifiedDate: number;
}

export interface DeviceFileReference {
  pk: string; // DEVICE#{deviceId}
  sk: string; // DEVICE_FILE#{fileId}
  deviceId: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  createdDate: number;
  modifiedDate: number;
}

export class DeviceMappingRepository {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    this.docClient = ddbDocClient;
    this.tableName = process.env.DEVICE_TABLE || '';
  }

  /**
   * Assign device to user
   */
  async assignDeviceToUser(deviceId: string, userId: string): Promise<DeviceUserMapping> {
    const logger = createChildLogger(baseLogger, { deviceId, userId });
    const now = Date.now();

    const item: DeviceUserMapping = {
      pk: `DEVICE#${deviceId}`,
      sk: `DEVICE_USER#${userId}`,
      userId,
      deviceId,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
        }) as any,
      );
      logger.info({ event: 'device_user_mapping_created', deviceId, userId });
      return item;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        logger.warn({ event: 'device_user_mapping_already_exists', deviceId, userId });
        // Return existing mapping
        const existing = await this.getDeviceUserMapping(deviceId, userId);
        if (existing) {
          return existing;
        }
      }
      logger.error({ event: 'device_user_mapping_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Remove device from user
   */
  async removeDeviceFromUser(deviceId: string, userId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { deviceId, userId });
    try {
      await this.docClient.send(
          new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE#${deviceId}`,
            sk: `DEVICE_USER#${userId}`,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }) as any,
      );
      logger.info({ event: 'device_user_mapping_deleted', deviceId, userId });
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        logger.warn({ event: 'device_user_mapping_not_found', deviceId, userId });
        throw new Error(`Device-User mapping not found for deviceId: ${deviceId}, userId: ${userId}`);
      }
      logger.error({ event: 'device_user_mapping_delete_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get device-user mapping
   */
  async getDeviceUserMapping(deviceId: string, userId: string): Promise<DeviceUserMapping | null> {
    const logger = createChildLogger(baseLogger, { deviceId, userId });
    try {
      const result:any = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE#${deviceId}`,
            sk: `DEVICE_USER#${userId}`,
          },
        }) as any,
      );
      return (result.Item as DeviceUserMapping) || null;
    } catch (err) {
      logger.error({ event: 'get_device_user_mapping_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * List all users mapped to a device
   */
  async listDeviceUsers(deviceId: string): Promise<DeviceUserMapping[]> {
    const logger = createChildLogger(baseLogger, { deviceId });
    try {
      const result:any = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `DEVICE#${deviceId}`,
            ':skPrefix': 'DEVICE_USER#',
          },
        }) as any,
      );
      return (result.Items || []) as DeviceUserMapping[];
    } catch (err) {
      logger.error({ event: 'list_device_users_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Assign device to organization
   */
  async assignDeviceToOrganization(deviceId: string, organizationId: string): Promise<DeviceOrgMapping> {
    const logger = createChildLogger(baseLogger, { deviceId, organizationId });
    const now = Date.now();

    const item: DeviceOrgMapping = {
      pk: `DEVICE#${deviceId}`,
      sk: `DEVICE_ORG#${organizationId}`,
      organizationId,
      deviceId,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
        }) as any,
      );
      logger.info({ event: 'device_org_mapping_created', deviceId, organizationId });
      return item;
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        logger.warn({ event: 'device_org_mapping_already_exists', deviceId, organizationId });
        // Return existing mapping
        const existing = await this.getDeviceOrgMapping(deviceId, organizationId);
        if (existing) {
          return existing;
        }
      }
      logger.error({ event: 'device_org_mapping_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Remove device from organization
   */
  async removeDeviceFromOrganization(deviceId: string, organizationId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { deviceId, organizationId });
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE#${deviceId}`,
            sk: `DEVICE_ORG#${organizationId}`,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }) as any,
      );
      logger.info({ event: 'device_org_mapping_deleted', deviceId, organizationId });
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        logger.warn({ event: 'device_org_mapping_not_found', deviceId, organizationId });
        throw new Error(`Device-Organization mapping not found for deviceId: ${deviceId}, organizationId: ${organizationId}`);
      }
      logger.error({ event: 'device_org_mapping_delete_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get device-organization mapping
   */
  async getDeviceOrgMapping(deviceId: string, organizationId: string): Promise<DeviceOrgMapping | null> {
    const logger = createChildLogger(baseLogger, { deviceId, organizationId });
    try {
      const result:any = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE#${deviceId}`,
            sk: `DEVICE_ORG#${organizationId}`,
          },
        }) as any,
      );
      return (result.Item as DeviceOrgMapping) || null;
    } catch (err) {
      logger.error({ event: 'get_device_org_mapping_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * List all organizations mapped to a device
   */
  async listDeviceOrganizations(deviceId: string): Promise<DeviceOrgMapping[]> {
    const logger = createChildLogger(baseLogger, { deviceId });
    try {
      const result:any = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `DEVICE#${deviceId}`,
            ':skPrefix': 'DEVICE_ORG#',
          },
        }) as any,
      );
      return (result.Items || []) as DeviceOrgMapping[];
    } catch (err) {
      logger.error({ event: 'list_device_organizations_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Create or update device metadata
   */
  async upsertDeviceMetadata(deviceId: string, metadata: Record<string, unknown>): Promise<DeviceMetadata> {
    const logger = createChildLogger(baseLogger, { deviceId });
    const now = Date.now();

    // Get existing metadata if it exists
    const existing = await this.getDeviceMetadata(deviceId);
    const mergedMetadata = existing ? { ...existing.metadata, ...metadata } : metadata;

    const item: DeviceMetadata = {
      pk: `DEVICE#${deviceId}`,
      sk: 'DEVICE_METADATA',
      deviceId,
      metadata: mergedMetadata,
      createdDate: existing?.createdDate || now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }) as any,
      );
      logger.info({ event: 'device_metadata_upserted', deviceId });
      return item;
    } catch (err) {
      logger.error({ event: 'device_metadata_upsert_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get device metadata
   */
  async getDeviceMetadata(deviceId: string): Promise<DeviceMetadata | null> {
    const logger = createChildLogger(baseLogger, { deviceId });
    try {
      const result:any = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE#${deviceId}`,
            sk: 'DEVICE_METADATA',
          },
        }) as any,
      );
      return (result.Item as DeviceMetadata) || null;
    } catch (err) {
      logger.error({ event: 'get_device_metadata_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Check if device exists (by checking for DEVICE_DETAILS)
   */
  async deviceExists(deviceId: string): Promise<boolean> {
    const logger = createChildLogger(baseLogger, { deviceId });
    try {
      const result:any = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `DEVICE#${deviceId}`,
            sk: 'DEVICE_DETAILS',
          },
        }) as any,
      );
      return !!result.Item;
    } catch (err) {
      logger.error({ event: 'check_device_exists_error', err: serializeError(err) });
      return false;
    }
  }

  /**
   * Create device file reference
   */
  async createDeviceFileReference(
    deviceId: string,
    fileId: string,
    fileName: string,
    fileUrl: string,
    fileSize?: number,
    mimeType?: string,
  ): Promise<DeviceFileReference> {
    const logger = createChildLogger(baseLogger, { deviceId, fileId });
    const now = Date.now();

    const item: DeviceFileReference = {
      pk: `DEVICE#${deviceId}`,
      sk: `DEVICE_FILE#${fileId}`,
      deviceId,
      fileId,
      fileName,
      fileUrl,
      fileSize,
      mimeType,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }) as any,
      );
      logger.info({ event: 'device_file_reference_created', deviceId, fileId });
      return item;
    } catch (err) {
      logger.error({ event: 'device_file_reference_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * List all file references for a device
   */
  async listDeviceFiles(deviceId: string): Promise<DeviceFileReference[]> {
    const logger = createChildLogger(baseLogger, { deviceId });
    try {
      const result:any = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `DEVICE#${deviceId}`,
            ':skPrefix': 'DEVICE_FILE#',
          },
        }) as any ,
      );
      return (result.Items || []) as DeviceFileReference[];
    } catch (err) {
      logger.error({ event: 'list_device_files_error', err: serializeError(err) });
      throw err;
    }
  }
}
