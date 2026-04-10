import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type BatchWriteCommandOutput,
  type DynamoDBDocumentClient,
  type GetCommandOutput,
  type PutCommandOutput,
  type QueryCommandOutput,
  type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { ENTITY_TYPE } from '../domain/constants';
import type { MetadataType, MetadataValue } from '../domain/types';
import {
  fromMetadataTypeItem,
  fromMetadataValueItem,
  toApplItem,
  toMetadataTypeItem,
  toMetadataValueItem,
  type MetadataApplItem,
} from '../mappers/dynamodb.mapper';
import {
  LSI_CREATED_AT,
  LSI_ENTITY_TYPE,
  LSI_STATUS,
  LSI_UPDATED_AT,
  LSI_VALUE_CODE,
  gsi1pkRegistryTypes,
  gsi1pkTypeValues,
  gsi1skMetadataValue,
  pkMetadataType,
  skAppl,
  skTypeMetadata,
  skValue,
} from './keys';

const baseLogger = createLogger({ service: 'metadata-registry-repository' });

async function sendDoc<T>(
  client: DynamoDBDocumentClient,
  command: unknown,
): Promise<T> {
  return (await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command)) as T;
}

const BATCH_SIZE = 25;
const DEFAULT_PAGE_SIZE = 50;

export interface PaginatedResult<T> {
  items: T[];
  nextToken?: string;
}

function encodeToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function decodeToken(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
}

export class MetadataRegistryRepository {
  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    if (!tableName) {
      throw new Error('METADATA_REGISTRY_TABLE is not configured');
    }
  }

  async getMetadataType(metadataTypeCode: string): Promise<MetadataType | null> {
    const pk = pkMetadataType(metadataTypeCode);
    const sk = skTypeMetadata();
    const result = await sendDoc<GetCommandOutput>(
      this.docClient,
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }),
    );
    const item = result.Item as Record<string, unknown> | undefined;
    if (!item || item.entityType !== ENTITY_TYPE.METADATA_TYPE) {
      return null;
    }
    return fromMetadataTypeItem(item);
  }

  async putMetadataType(type: MetadataType): Promise<void> {
    const item = toMetadataTypeItem(type);
    await sendDoc<PutCommandOutput>(
      this.docClient,
      new PutCommand({
        TableName: this.tableName,
        Item: item as unknown as Record<string, unknown>,
        ConditionExpression: 'attribute_not_exists(#sk)',
        ExpressionAttributeNames: { '#sk': 'sk' },
      }),
    );
  }

  async updateMetadataType(metadataTypeCode: string, patch: Partial<MetadataType>): Promise<MetadataType> {
    const pk = pkMetadataType(metadataTypeCode);
    const sk = skTypeMetadata();
    const names: Record<string, string> = {
      '#ua': 'updatedAt',
      '#et': 'entityType',
      '#sk3': 'sk3',
    };
    const values: Record<string, unknown> = {
      ':ua': patch.updatedAt,
      ':et': ENTITY_TYPE.METADATA_TYPE,
      ':sk3': patch.updatedAt,
    };
    const sets: string[] = ['#ua = :ua', '#sk3 = :sk3'];
    let idx = 0;
    const assign = (field: keyof MetadataType, attr: string) => {
      if (patch[field] === undefined) return;
      const nk = `#f${idx}`;
      const vk = `:v${idx}`;
      names[nk] = attr;
      values[vk] = patch[field];
      sets.push(`${nk} = ${vk}`);
      idx += 1;
    };
    assign('displayName', 'displayName');
    assign('description', 'description');
    assign('valueDataType', 'valueDataType');
    assign('multiSelectAllowed', 'multiSelectAllowed');
    assign('applicableModules', 'applicableModules');
    assign('attributeSchema', 'attributeSchema');
    assign('status', 'status');
    assign('version', 'version');
    assign('updatedBy', 'updatedBy');

    if (patch.status) {
      names['#sk1'] = 'sk1';
      values[':sk1'] = patch.status;
      sets.push('#sk1 = :sk1');
    }

    const result = await sendDoc<UpdateCommandOutput>(
      this.docClient,
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(pk) AND #et = :et',
        ReturnValues: 'ALL_NEW',
      }),
    );
    const out = result.Attributes as Record<string, unknown>;
    return fromMetadataTypeItem(out);
  }

  async listMetadataTypes(): Promise<MetadataType[]> {
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :gpk',
        ExpressionAttributeValues: {
          ':gpk': gsi1pkRegistryTypes(),
        },
      }),
    );
    const items = (result.Items ?? []) as Record<string, unknown>[];
    return items
      .filter((it) => it.entityType === ENTITY_TYPE.METADATA_TYPE)
      .map((it) => fromMetadataTypeItem(it));
  }

  async listMetadataTypesPaginated(
    limit: number = DEFAULT_PAGE_SIZE,
    nextToken?: string,
  ): Promise<PaginatedResult<MetadataType>> {
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :gpk',
        ExpressionAttributeValues: {
          ':gpk': gsi1pkRegistryTypes(),
        },
        Limit: limit,
        ExclusiveStartKey: nextToken ? decodeToken(nextToken) : undefined,
      }),
    );
    const items = (result.Items ?? []) as Record<string, unknown>[];
    return {
      items: items
        .filter((it) => it.entityType === ENTITY_TYPE.METADATA_TYPE)
        .map((it) => fromMetadataTypeItem(it)),
      nextToken: result.LastEvaluatedKey
        ? encodeToken(result.LastEvaluatedKey as Record<string, unknown>)
        : undefined,
    };
  }

  async listMetadataValuesPaginated(
    metadataTypeCode: string,
    limit: number = DEFAULT_PAGE_SIZE,
    nextToken?: string,
    statusFilter?: 'ACTIVE' | 'INACTIVE',
  ): Promise<PaginatedResult<MetadataValue>> {
    const gsi1pk = gsi1pkTypeValues(metadataTypeCode);

    const keyExpr = statusFilter
      ? 'gsi1pk = :gpk AND begins_with(gsi1sk, :statusPrefix)'
      : 'gsi1pk = :gpk';

    const exprValues: Record<string, unknown> = { ':gpk': gsi1pk };
    if (statusFilter) {
      exprValues[':statusPrefix'] = `${statusFilter}#`;
    }

    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: keyExpr,
        ExpressionAttributeValues: exprValues,
        Limit: limit,
        ExclusiveStartKey: nextToken ? decodeToken(nextToken) : undefined,
      }),
    );
    const items = (result.Items ?? []) as Record<string, unknown>[];
    return {
      items: items
        .filter((it) => it.entityType === ENTITY_TYPE.METADATA_VALUE)
        .map((it) => fromMetadataValueItem(it)),
      nextToken: result.LastEvaluatedKey
        ? encodeToken(result.LastEvaluatedKey as Record<string, unknown>)
        : undefined,
    };
  }

  async getMetadataValue(metadataTypeCode: string, metadataValueCode: string): Promise<MetadataValue | null> {
    const pk = pkMetadataType(metadataTypeCode);
    const sk = skValue(metadataValueCode);
    const result = await sendDoc<GetCommandOutput>(
      this.docClient,
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }),
    );
    const item = result.Item as Record<string, unknown> | undefined;
    if (!item || item.entityType !== ENTITY_TYPE.METADATA_VALUE) {
      return null;
    }
    return fromMetadataValueItem(item);
  }

  async listMetadataValues(metadataTypeCode: string): Promise<MetadataValue[]> {
    const gsi1pk = gsi1pkTypeValues(metadataTypeCode);
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :gpk',
        ExpressionAttributeValues: {
          ':gpk': gsi1pk,
        },
      }),
    );
    const items = (result.Items ?? []) as Record<string, unknown>[];
    return items
      .filter((it) => it.entityType === ENTITY_TYPE.METADATA_VALUE)
      .map((it) => fromMetadataValueItem(it));
  }

  async putMetadataValue(value: MetadataValue): Promise<void> {
    const item = toMetadataValueItem(value);
    await sendDoc<PutCommandOutput>(
      this.docClient,
      new PutCommand({
        TableName: this.tableName,
        Item: item as unknown as Record<string, unknown>,
        ConditionExpression: 'attribute_not_exists(#sk)',
        ExpressionAttributeNames: { '#sk': 'sk' },
      }),
    );
  }

  async updateMetadataValue(
    metadataTypeCode: string,
    metadataValueCode: string,
    patch: Partial<MetadataValue>,
  ): Promise<MetadataValue> {
    const pk = pkMetadataType(metadataTypeCode);
    const sk = skValue(metadataValueCode);
    const names: Record<string, string> = {
      '#ua': 'updatedAt',
      '#et': 'entityType',
      '#sk3': 'sk3',
    };
    const values: Record<string, unknown> = {
      ':ua': patch.updatedAt,
      ':et': ENTITY_TYPE.METADATA_VALUE,
      ':sk3': patch.updatedAt,
    };
    const sets: string[] = ['#ua = :ua', '#sk3 = :sk3'];
    let idx = 0;
    const assign = (field: keyof MetadataValue, attr: string) => {
      if (patch[field] === undefined) return;
      const nk = `#vf${idx}`;
      const vk = `:vv${idx}`;
      names[nk] = attr;
      values[vk] = patch[field];
      sets.push(`${nk} = ${vk}`);
      idx += 1;
    };
    assign('label', 'label');
    assign('description', 'description');
    assign('status', 'status');
    assign('isGlobal', 'isGlobal');
    assign('applicableModules', 'applicableModules');
    assign('applicableCategories', 'applicableCategories');
    assign('applicableConditions', 'applicableConditions');
    assign('applicableCountries', 'applicableCountries');
    assign('valueAttributes', 'valueAttributes');
    assign('version', 'version');
    assign('updatedBy', 'updatedBy');

    if (patch.status) {
      names['#gsi1sk'] = 'gsi1sk';
      values[':gsi1sk'] = gsi1skMetadataValue(patch.status, metadataValueCode);
      sets.push('#gsi1sk = :gsi1sk');

      names['#sk1'] = 'sk1';
      values[':sk1'] = patch.status;
      sets.push('#sk1 = :sk1');
    }

    const result = await sendDoc<UpdateCommandOutput>(
      this.docClient,
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(pk) AND #et = :et',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return fromMetadataValueItem(result.Attributes as Record<string, unknown>);
  }

  async getApplItem(
    metadataTypeCode: string,
    module: string,
    category: string,
    condition: string,
    country: string,
    metadataValueCode: string,
  ): Promise<MetadataApplItem | null> {
    const pk = pkMetadataType(metadataTypeCode);
    const sk = skAppl(module, category, condition, country, metadataValueCode);
    const result = await sendDoc<GetCommandOutput>(
      this.docClient,
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }),
    );
    const item = result.Item as Record<string, unknown> | undefined;
    if (!item || item.entityType !== ENTITY_TYPE.METADATA_APPL) {
      return null;
    }
    return item as unknown as MetadataApplItem;
  }

  async deleteAllApplForValue(metadataTypeCode: string, metadataValueCode: string): Promise<void> {
    const pk = pkMetadataType(metadataTypeCode);
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await sendDoc<QueryCommandOutput>(
        this.docClient,
        new QueryCommand({
          TableName: this.tableName,
          IndexName: LSI_VALUE_CODE,
          KeyConditionExpression: 'pk = :pk AND sk4 = :vc',
          FilterExpression: 'entityType = :et',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':vc': metadataValueCode,
            ':et': ENTITY_TYPE.METADATA_APPL,
          },
          ExclusiveStartKey: lastKey,
        }),
      );
      const items = (result.Items ?? []) as Record<string, unknown>[];

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const chunk = items.slice(i, i + BATCH_SIZE);
        await sendDoc<BatchWriteCommandOutput>(
          this.docClient,
          new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: chunk.map((it) => ({
                DeleteRequest: {
                  Key: { pk: it.pk, sk: it.sk },
                },
              })),
            },
          }),
        );
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
  }

  async writeApplRows(
    metadataTypeCode: string,
    metadataValueCode: string,
    tuples: Array<[string, string, string, string]>,
  ): Promise<void> {
    const rows = tuples.map((t) => toApplItem(metadataTypeCode, metadataValueCode, t));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      await sendDoc<BatchWriteCommandOutput>(
        this.docClient,
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk.map((row) => ({
              PutRequest: {
                Item: row as Record<string, unknown>,
              },
            })),
          },
        }),
      );
    }
  }

  async replaceApplRows(
    metadataTypeCode: string,
    metadataValueCode: string,
    tuples: Array<[string, string, string, string]>,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { metadataTypeCode, metadataValueCode });
    try {
      await this.deleteAllApplForValue(metadataTypeCode, metadataValueCode);
      await this.writeApplRows(metadataTypeCode, metadataValueCode, tuples);
    } catch (err) {
      logger.error({ event: 'replaceApplRows_failed', err: serializeError(err) });
      throw err;
    }
  }

  async listMetadataValuesByStatus(
    metadataTypeCode: string,
    status: 'ACTIVE' | 'INACTIVE',
  ): Promise<MetadataValue[]> {
    const pk = pkMetadataType(metadataTypeCode);
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: LSI_STATUS,
        KeyConditionExpression: 'pk = :pk AND sk1 = :s',
        FilterExpression: 'entityType = :et',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':s': status,
          ':et': ENTITY_TYPE.METADATA_VALUE,
        },
      }),
    );
    return ((result.Items ?? []) as Record<string, unknown>[]).map(fromMetadataValueItem);
  }

  async listItemsByCreatedAt(
    metadataTypeCode: string,
    options?: { from?: string; to?: string; scanForward?: boolean },
  ): Promise<MetadataValue[]> {
    const pk = pkMetadataType(metadataTypeCode);
    let keyExpr = 'pk = :pk';
    const exprValues: Record<string, unknown> = { ':pk': pk, ':et': ENTITY_TYPE.METADATA_VALUE };
    if (options?.from && options?.to) {
      keyExpr += ' AND sk2 BETWEEN :from AND :to';
      exprValues[':from'] = options.from;
      exprValues[':to'] = options.to;
    } else if (options?.from) {
      keyExpr += ' AND sk2 >= :from';
      exprValues[':from'] = options.from;
    } else if (options?.to) {
      keyExpr += ' AND sk2 <= :to';
      exprValues[':to'] = options.to;
    }
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: LSI_CREATED_AT,
        KeyConditionExpression: keyExpr,
        FilterExpression: 'entityType = :et',
        ExpressionAttributeValues: exprValues,
        ScanIndexForward: options?.scanForward ?? true,
      }),
    );
    return ((result.Items ?? []) as Record<string, unknown>[]).map(fromMetadataValueItem);
  }

  async listItemsByUpdatedAt(
    metadataTypeCode: string,
    options?: { since?: string; scanForward?: boolean },
  ): Promise<MetadataValue[]> {
    const pk = pkMetadataType(metadataTypeCode);
    let keyExpr = 'pk = :pk';
    const exprValues: Record<string, unknown> = { ':pk': pk, ':et': ENTITY_TYPE.METADATA_VALUE };
    if (options?.since) {
      keyExpr += ' AND sk3 >= :since';
      exprValues[':since'] = options.since;
    }
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: LSI_UPDATED_AT,
        KeyConditionExpression: keyExpr,
        FilterExpression: 'entityType = :et',
        ExpressionAttributeValues: exprValues,
        ScanIndexForward: options?.scanForward ?? false,
      }),
    );
    return ((result.Items ?? []) as Record<string, unknown>[]).map(fromMetadataValueItem);
  }

  async listItemsByEntityType(
    metadataTypeCode: string,
    entityType: string,
  ): Promise<Record<string, unknown>[]> {
    const pk = pkMetadataType(metadataTypeCode);
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        IndexName: LSI_ENTITY_TYPE,
        KeyConditionExpression: 'pk = :pk AND sk5 = :et',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':et': entityType,
        },
      }),
    );
    return (result.Items ?? []) as Record<string, unknown>[];
  }
}
