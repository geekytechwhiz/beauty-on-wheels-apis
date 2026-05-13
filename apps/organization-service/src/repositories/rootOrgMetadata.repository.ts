import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const ROOT_PERMISSIONS = 'ROOT_PERMISSIONS';
const ORG_PERMISSIONS = 'ORG_PERMISSIONS';
const ORG_META = 'ORG_META';
const SUPPORTED_VITALS = 'SUPPORTED_VITALS';
const SUPPORTED_RELATIONS = 'SUPPORTED_RELATIONS';
const SUPPORTED_SPECIALTY = 'SUPPORTED_SPECIALTY';

const ORGANIZATION_TABLE_NAME = process.env.ORGANIZATION_TABLE || '';

export class RootOrgMetadataRepository {
  private ensureTable(): string {
    if (!ORGANIZATION_TABLE_NAME) {
      throw new Error('ORGANIZATION_TABLE is not configured');
    }
    return ORGANIZATION_TABLE_NAME;
  }

  async getRootOrgPermissionsList(type: 'ROOT' | 'ORGANIZATION'): Promise<unknown[]> {
    const tableName = this.ensureTable();
    const logger = createChildLogger(baseLogger, { type });
    const pk = type === 'ROOT' ? ROOT_PERMISSIONS : ORG_PERMISSIONS;
    const params = {
      TableName: tableName,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
      },
      ExpressionAttributeNames: {
        '#pk': 'pk',
      },
    };
    try {
      const { Items } = await ddbDocClient.send(new QueryCommand(params));
      const permissions = Items?.[0]?.permissions;
      return Array.isArray(permissions) ? permissions : [];
    } catch (err) {
      logger.error({ event: 'root_org_permissions_error', err: serializeError(err) });
      throw err;
    }
  }

  async getOrgTypeSize(): Promise<any[]> {
    const tableName = this.ensureTable();
    const params = {
      TableName: tableName,
      KeyConditionExpression: 'pk = :pkValue',
      ExpressionAttributeValues: {
        ':pkValue': ORG_META,
      },
    };
    try {
      const results: any[] = [];
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const res = await ddbDocClient.send(
          new QueryCommand({
            ...params,
            ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
          }),
        );
        if (res.Items) results.push(...res.Items);
        lastEvaluatedKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey);
      return results;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { event: 'org_type_size_error' });
      logger.error({ err: serializeError(err) });
      throw err;
    }
  }

  private async getOrgMetaAttributes(sk: string): Promise<Record<string, unknown> | undefined> {
    const tableName = this.ensureTable();
    const params = {
      TableName: tableName,
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#sk': 'sk',
      },
      ExpressionAttributeValues: {
        ':pk': ORG_META,
        ':sk': sk,
      },
      KeyConditionExpression: '#pk = :pk AND #sk = :sk',
    };
    const { Items } = await ddbDocClient.send(new QueryCommand(params));
    return (Items?.[0]?.attributes ?? undefined) as Record<string, unknown> | undefined;
  }

  async getOrgSupportedVitals(): Promise<Record<string, unknown> | undefined> {
    return this.getOrgMetaAttributes(SUPPORTED_VITALS);
  }

  async getOrgSupportedRelations(): Promise<Record<string, unknown> | undefined> {
    return this.getOrgMetaAttributes(SUPPORTED_RELATIONS);
  }

  async getOrgSupportedSpecialty(): Promise<Record<string, unknown> | undefined> {
    return this.getOrgMetaAttributes(SUPPORTED_SPECIALTY);
  }

  /**
   * Put or overwrite SUPPORTED_VITALS metadata in the organization table (pk=ORG_META, sk=SUPPORTED_VITALS).
   * Idempotent; safe to call on every health check or deploy.
   */
  async putOrgVitalsMetadata(attributes: unknown[]): Promise<void> {
    const tableName = this.ensureTable();
    const now = Date.now();
    const item = {
      pk: ORG_META,
      sk: SUPPORTED_VITALS,
      attributes,
      createdDate: now,
      modifiedDate: now,
    };
    await ddbDocClient.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      })
    );
  }
}
