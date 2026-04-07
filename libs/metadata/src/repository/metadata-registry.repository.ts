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
import { gsi1pkRegistryTypes, pkMetadataType, skAppl, skTypeMetadata, skValue } from './keys';

const baseLogger = createLogger({ service: 'metadata-registry-repository' });

async function sendDoc<T>(
  client: DynamoDBDocumentClient,
  command: unknown,
): Promise<T> {
  return (await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command)) as T;
}

const APPL_PREFIX = 'APPL#';
const VALUE_PREFIX = 'VALUE#';
const BATCH_SIZE = 25;

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
    };
    const values: Record<string, unknown> = {
      ':ua': patch.updatedAt,
      ':et': ENTITY_TYPE.METADATA_TYPE,
    };
    const sets: string[] = ['#ua = :ua'];
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
    const pk = pkMetadataType(metadataTypeCode);
    const result = await sendDoc<QueryCommandOutput>(
      this.docClient,
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(#sk, :vp)',
        ExpressionAttributeNames: { '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':vp': VALUE_PREFIX,
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
    const names: Record<string, string> = { '#ua': 'updatedAt', '#et': 'entityType' };
    const values: Record<string, unknown> = {
      ':ua': patch.updatedAt,
      ':et': ENTITY_TYPE.METADATA_VALUE,
    };
    const sets: string[] = ['#ua = :ua'];
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
    const suffix = `#VALUE#${metadataValueCode}`;
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await sendDoc<QueryCommandOutput>(
        this.docClient,
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(#sk, :ap)',
          ExpressionAttributeNames: { '#sk': 'sk' },
          ExpressionAttributeValues: {
            ':pk': pk,
            ':ap': APPL_PREFIX,
          },
          ExclusiveStartKey: lastKey,
        }),
      );
      const items = (result.Items ?? []).filter((it) => {
        const sk = String((it as { sk?: string }).sk ?? '');
        return sk.endsWith(suffix);
      }) as Record<string, unknown>[];

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
}
