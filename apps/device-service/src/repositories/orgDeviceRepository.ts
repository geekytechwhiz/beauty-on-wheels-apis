import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { OrgDevice } from '../models';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'org-device-repository' });

export class OrgDeviceRepository {
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
   * Create bidirectional organization-device mappings with full device details
   */
  async addOrgDevice(
    organizationId: string,
    device: {
      deviceId: string;
      category: string;
      name: string;
      enabled?: boolean;
      isAutoSyncSupported?: boolean;
      displayName?: string;
      deviceImage?: string;
      countriesSupported?: string[];
      manufacturerImage?: string;
      manufacturerName?: string;
      template?: number;
      deviceDetails?: string;
      supportedVitals?: string[];
    },
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { organizationId, deviceId: device.deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(device.deviceId);
    const now = Date.now();

    // Forward mapping: Organization → Device
    // Access pattern: pk: ORG_DEVICES#{orgId}, sk: {deviceId}
    const forwardEntry: OrgDevice = {
      pk: `ORG_DEVICES#${organizationId}`,
      sk: normalizedDeviceId,
      sk1: device.category.toUpperCase().split(' ').join('_'),
      sk2: device.name.toUpperCase().split(' ').join('_'),
      sk3: `${device.category}#${device.name}`,
      organizationID: organizationId,
      isActive: true,
      enabled: device.enabled ?? true,
      isAutoSyncSupported: device.isAutoSyncSupported ?? true,
      name: device.name,
      category: device.category,
      deviceId: device.deviceId,
      displayName: device.displayName,
      deviceImage: device.deviceImage,
      countriesSupported: device.countriesSupported,
      manufacturerImage: device.manufacturerImage,
      manufacturerName: device.manufacturerName,
      template: device.template,
      deviceDetails: device.deviceDetails,
      supportedVitals: device.supportedVitals,
      createdDate: now,
      modifiedDate: now,
    };

    // Reverse mapping: Device → Organization
    // Access pattern: pk: ORG_DEVICES#{deviceId}, sk: {orgId}
    const reverseEntry: OrgDevice = {
      pk: `ORG_DEVICES#${normalizedDeviceId}`,
      sk: organizationId,
      sk1: device.category.toUpperCase().split(' ').join('_'),
      sk2: device.name.toUpperCase().split(' ').join('_'),
      sk3: `${device.category}#${device.name}`,
      organizationID: organizationId,
      isActive: true,
      enabled: device.enabled ?? true,
      isAutoSyncSupported: device.isAutoSyncSupported ?? true,
      name: device.name,
      category: device.category,
      deviceId: device.deviceId,
      displayName: device.displayName,
      deviceImage: device.deviceImage,
      countriesSupported: device.countriesSupported,
      manufacturerImage: device.manufacturerImage,
      manufacturerName: device.manufacturerName,
      template: device.template,
      deviceDetails: device.deviceDetails,
      supportedVitals: device.supportedVitals,
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
   * Sets isActive=false on every row for this org (org→device forward items under ORG_DEVICES#{orgId},
   * and device→org reverse items). Call before writing the new active device set.
   */
  async deactivateAllOrgDevicesForOrganization(organizationId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { organizationId });
    const forwardPk = `ORG_DEVICES#${organizationId}`;
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const now = Date.now();

    try {
      do {
        const result = (await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': forwardPk },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        )) as QueryCommandOutput;

        await Promise.all(
          (result.Items ?? []).map(async (raw) => {
            const sk = raw.sk as string | undefined;
            if (!sk) return;

            await this.docClient.send(
              new UpdateCommand({
                TableName: this.tableName,
                Key: { pk: forwardPk, sk },
                UpdateExpression: 'SET isActive = :inactive, modifiedDate = :modifiedDate',
                ExpressionAttributeValues: { ':inactive': false, ':modifiedDate': now },
              }),
            );

            if (sk === 'NON-DEVICES') return;

            try {
              await this.docClient.send(
                new UpdateCommand({
                  TableName: this.tableName,
                  Key: { pk: `ORG_DEVICES#${sk}`, sk: organizationId },
                  UpdateExpression: 'SET isActive = :inactive, modifiedDate = :modifiedDate',
                  ExpressionAttributeValues: { ':inactive': false, ':modifiedDate': now },
                }),
              );
            } catch (err) {
              logger.warn({
                event: 'deactivate_org_device_reverse_mapping_failed',
                organizationId,
                sk,
                err: serializeError(err),
              });
            }
          }),
        );

        exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);

      logger.info({ event: 'deactivate_all_org_devices_done', organizationId });
    } catch (err) {
      logger.error({ event: 'deactivate_all_org_devices_error', err: serializeError(err) });
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
    return device !== null && device?.enabled === true && device?.isActive !== false;
  }

  /**
   * Upsert NON-DEVICES entry for an org: vitals that are supported by the org but have no devices.
   * Access pattern: pk: ORG_DEVICES#{orgId}, sk: NON-DEVICES
   */
  async upsertNonDeviceVitals(organizationId: string, supportedVitals: string[]): Promise<void> {
    const logger = createChildLogger(baseLogger, { organizationId });
    const now = Date.now();

    const entry = {
      pk: `ORG_DEVICES#${organizationId}`,
      sk: 'NON-DEVICES',
      category: 'NON-DEVICES',
      organizationID: organizationId,
      isActive: true,
      supportedVitals,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: entry,
        }),
      );
      logger.info({ event: 'non_device_vitals_upserted', supportedVitalsCount: supportedVitals.length });
    } catch (err) {
      logger.error({ event: 'non_device_vitals_upsert_error', err: serializeError(err) });
      throw err;
    }
  }
}
