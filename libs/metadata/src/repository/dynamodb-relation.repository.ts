import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { monotonicFactory } from 'ulid';

import type {
  CreateMetadataRelationInput,
  MetadataRelationRecord,
} from '../domain/relation-types';
import { RELATION_ENTITY_TYPE, RELATION_STATUS } from '../domain/relation-types';
import { ConflictError, NotFoundError } from '../domain/errors';
import {
  auditRelationPartitionKey,
  encodeRelationId,
  relationPartitionKey,
  relationSortKey,
} from '../domain/relation-keys';
import type { IRelationRepository, ListRelationsByFromOptions } from './relation.repository.interface';

const ulid = monotonicFactory();

export interface DynamoDbRelationRepositoryOptions {
  pkAttr?: string;
  skAttr?: string;
}

export class DynamoDbRelationRepository implements IRelationRepository {
  private readonly pkAttr: string;
  private readonly skAttr: string;

  constructor(
    private readonly doc: { send: (command: unknown) => Promise<unknown> },
    private readonly tableName: string,
    options?: DynamoDbRelationRepositoryOptions,
  ) {
    this.pkAttr = options?.pkAttr ?? 'PK';
    this.skAttr = options?.skAttr ?? 'SK';
  }

  private key(pk: string, sk: string): Record<string, string> {
    return { [this.pkAttr]: pk, [this.skAttr]: sk };
  }

  private rethrowDynamo(op: string, e: unknown): never {
    if (!e || typeof e !== 'object') {
      throw e;
    }
    const ex = e as { name?: string; message?: string; __type?: string };
    const name = String(ex.name ?? '');
    const msg = String(ex.message ?? '');
    const looksCond =
      name === 'ConditionalCheckFailedException' || msg.includes('ConditionalCheckFailedException');
    if (looksCond) {
      throw e;
    }
    const looksValidation =
      name === 'ValidationException' || msg === 'ValidationException' || msg.includes('ValidationException');
    const looksRnf =
      name === 'ResourceNotFoundException' ||
      msg.includes('ResourceNotFoundException') ||
      msg.includes('non-existent table') ||
      msg.includes('Cannot find');
    if (looksValidation || looksRnf) {
      const label = looksValidation ? 'ValidationException' : 'ResourceNotFoundException';
      throw new Error(
        `${label} during ${op} on table "${this.tableName}": ${msg}. ` +
          `Key attributes: partition="${this.pkAttr}", sort="${this.skAttr}".`,
      );
    }
    throw e;
  }

  private async queryAll(
    pk: string,
    opts: { skBeginsWith?: string } = {},
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    const useBegins = opts.skBeginsWith !== undefined && opts.skBeginsWith.length > 0;
    do {
      try {
        // Only include the sort-key name placeholder when `begins_with` is used. Including `#sk` in
        // ExpressionAttributeNames when it does not appear in KeyConditionExpression can cause
        // DynamoDB to return ValidationException.
        const names = useBegins
          ? { '#pk': this.pkAttr, '#sk': this.skAttr }
          : { '#pk': this.pkAttr };
        const res = (await this.doc.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: useBegins
              ? '#pk = :pk AND begins_with(#sk, :prefix)'
              : '#pk = :pk',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: useBegins
              ? { ':pk': pk, ':prefix': opts.skBeginsWith as string }
              : { ':pk': pk },
            ExclusiveStartKey: startKey,
          }),
        )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
        out.push(...(res.Items ?? []));
        startKey = res.LastEvaluatedKey;
      } catch (e: unknown) {
        this.rethrowDynamo('Query', e);
      }
    } while (startKey);
    return out;
  }

  async createRelation(
    input: CreateMetadataRelationInput,
    actor?: string,
  ): Promise<MetadataRelationRecord> {
    const pk = relationPartitionKey(input.fromMetadataTypeCode, input.fromMetadataValueCode);
    const sk = relationSortKey(
      input.relationType,
      input.toMetadataTypeCode,
      input.toMetadataValueCode,
    );
    const id = encodeRelationId(pk, sk);
    const now = new Date().toISOString();
    const item: Record<string, unknown> = {
      ...this.key(pk, sk),
      entityType: RELATION_ENTITY_TYPE,
      id,
      relationType: input.relationType,
      fromMetadataTypeCode: input.fromMetadataTypeCode,
      fromMetadataValueCode: input.fromMetadataValueCode,
      toMetadataTypeCode: input.toMetadataTypeCode,
      toMetadataValueCode: input.toMetadataValueCode,
      status: RELATION_STATUS.ACTIVE,
      createdAt: now,
      ...(actor ? { createdBy: actor } : {}),
    };
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ExpressionAttributeNames: { '#pk': this.pkAttr, '#sk': this.skAttr },
          ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
        }),
      );
    } catch (e: unknown) {
      const n = (e as { name?: string })?.name;
      const msg = String((e as { message?: string })?.message ?? '');
      if (n === 'ConditionalCheckFailedException' || msg.includes('ConditionalCheckFailedException')) {
        throw new ConflictError('A relation with this from/to pair already exists');
      }
      this.rethrowDynamo('PutItem', e);
    }
    return this.unmarshal({ ...item, [this.pkAttr]: pk, [this.skAttr]: sk } as Record<string, unknown>);
  }

  async getRelationByKey(pk: string, sk: string): Promise<MetadataRelationRecord | null> {
    try {
      const res = (await this.doc.send(
        new GetCommand({ TableName: this.tableName, Key: this.key(pk, sk) }),
      )) as { Item?: Record<string, unknown> };
      const item = res.Item;
      if (!item || (item.entityType as string) !== RELATION_ENTITY_TYPE) {
        return null;
      }
      return this.unmarshal(item);
    } catch (e: unknown) {
      this.rethrowDynamo('GetItem', e);
    }
  }

  async listRelationsByFrom(
    fromMetadataTypeCode: string,
    fromMetadataValueCode: string,
    options?: ListRelationsByFromOptions,
  ): Promise<MetadataRelationRecord[]> {
    const pk = relationPartitionKey(fromMetadataTypeCode, fromMetadataValueCode);
    const items = await this.queryAll(pk, { skBeginsWith: options?.skBeginsWith });
    const records = items
      .filter((i) => i.entityType === RELATION_ENTITY_TYPE)
      .map((i) => this.unmarshal(i as Record<string, unknown>));
    return records.filter(
      (r) => (r.status ?? RELATION_STATUS.ACTIVE) === RELATION_STATUS.ACTIVE,
    );
  }

  async inactivateRelation(pk: string, sk: string, actor?: string): Promise<MetadataRelationRecord> {
    const existing = await this.getRelationByKey(pk, sk);
    if (!existing) {
      throw new NotFoundError('Relation not found');
    }
    if (existing.status === RELATION_STATUS.INACTIVE) {
      return existing;
    }
    const now = new Date().toISOString();
    const auditPk = auditRelationPartitionKey(
      existing.fromMetadataTypeCode,
      existing.fromMetadataValueCode,
    );
    const auditId = ulid();
    const auditSk = `TIMESTAMP#${now}#${auditId}`;

    const fromCode = existing.fromMetadataValueCode;
    const toCode = existing.toMetadataValueCode;

    const updateExpr = actor
      ? 'SET #s = :inactive, #ua = :now, #ub = :a'
      : 'SET #s = :inactive, #ua = :now';
    const updateNames: Record<string, string> = { '#s': 'status', '#ua': 'updatedAt' };
    if (actor) {
      updateNames['#ub'] = 'updatedBy';
    }
    const updateVals: Record<string, unknown> = {
      ':inactive': RELATION_STATUS.INACTIVE,
      ':now': now,
      ':active': RELATION_STATUS.ACTIVE,
    };
    if (actor) {
      updateVals[':a'] = actor;
    }

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: this.key(pk, sk),
                UpdateExpression: updateExpr,
                ExpressionAttributeNames: updateNames,
                ExpressionAttributeValues: updateVals,
                ConditionExpression: '#s = :active',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  ...this.key(auditPk, auditSk),
                  entityType: 'AUDIT',
                  entity: 'METADATA_RELATION',
                  auditId,
                  eventId: auditId,
                  action: 'INACTIVATE',
                  changedBy: actor,
                  timestamp: now,
                  relationPk: pk,
                  relationSk: sk,
                  oldValue: { status: RELATION_STATUS.ACTIVE, from: fromCode, to: toCode },
                  newValue: { status: RELATION_STATUS.INACTIVE, from: fromCode, to: toCode },
                },
              },
            },
          ] as any,
        }),
      );
    } catch (e: unknown) {
      this.rethrowDynamo('TransactWriteItems', e);
    }

    return {
      ...existing,
      status: RELATION_STATUS.INACTIVE,
      updatedAt: now,
      updatedBy: actor,
    };
  }

  private unmarshal(item: Record<string, unknown>): MetadataRelationRecord {
    const pk = item[this.pkAttr] as string;
    const sk = item[this.skAttr] as string;
    const id = (item.id as string) ?? encodeRelationId(pk, sk);
    return {
      id,
      relationType: item.relationType as MetadataRelationRecord['relationType'],
      fromMetadataTypeCode: item.fromMetadataTypeCode as string,
      fromMetadataValueCode: item.fromMetadataValueCode as string,
      toMetadataTypeCode: item.toMetadataTypeCode as string,
      toMetadataValueCode: item.toMetadataValueCode as string,
      status: (item.status as MetadataRelationRecord['status']) ?? RELATION_STATUS.ACTIVE,
      createdAt: (item.createdAt as string) ?? new Date().toISOString(),
      createdBy: item.createdBy as string | undefined,
      updatedAt: item.updatedAt as string | undefined,
      updatedBy: item.updatedBy as string | undefined,
    };
  }
}
