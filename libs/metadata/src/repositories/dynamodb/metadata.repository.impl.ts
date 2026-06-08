import {
  BatchGetCommand,
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { monotonicFactory } from 'ulid';

import {
  ENTITY_TYPE,
  TYPE_INDEX_PK,
  metadataTypeUsesSeparateSchemaItem,
  resolveAttributeSchemaForMetadataType,
  STATUS,
} from '../../constants';
import type {
  Applicability,
  AuditRecord,
  MetadataTypeInput,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
  ValueSearchFilter,
} from '../../models/types';
import type { ChangeRequestRecord } from '../../models/change-request.types';
import { CHANGE_REQUEST_STATUS } from '../../models/change-request.types';
import { ConflictError, NotFoundError } from '../../domain/errors';
import {
  auditTypePartitionKey,
  auditValuePartitionKey,
  buildApplSortKeys,
  extractValueCodeFromApplSk,
  LEGACY_TYPE_ENTITY_SK_V1,
  schemaSk,
  typeEntitySk,
  typeLatestPointerSk,
  typePartitionKey,
  valueLatestSk,
  valueSk,
} from '../../domain/keys';
import { getMetadataTypeDelta, typeCreateAuditNewValue } from '../../domain/type-audit-delta';
import {
  getMetadataValueDelta,
  resolveValueUpdateAction,
  valueCreateAuditNewValue,
} from '../../domain/value-audit-delta';
import { matchesSearchFilter, sortValuesForSearch } from '../../domain/search-filter';
import { MetadataKeyBuilder } from '../../builders/metadata-key.builder';
import type {
  IMetadataRegistryRepository,
  ListMetadataTypesPaginatedOptions,
  ListMetadataValuesPaginatedOptions,
  ListTypesFilter,
  MetadataTypeListEntry,
} from '../metadata-registry.repository.interface';

const ulid = monotonicFactory();

const BATCH_GET_SIZE = 25;
const BATCH_WRITE_SIZE = 25;
const TYPE_LIST_FETCH_SIZE = 40;
const VALUE_LIST_FETCH_SIZE = 40;
const LISTING_COUNTERS_LIST_ATTR = 'activeValueCount';
const LISTING_COUNTERS_INACTIVE_ATTR = 'inactiveValueCount';
const MAX_PAGE_ROUNDS = 12;

export interface DynamoDbMetadataRepositoryOptions {
  /** Partition key attribute name; must match the DynamoDB table (default `PK`). */
  pkAttr?: string;
  /** Sort key attribute name; must match the DynamoDB table (default `SK`). */
  skAttr?: string;
}

export class DynamoDbMetadataRegistryRepository implements IMetadataRegistryRepository {
  private readonly pkAttr: string;
  private readonly skAttr: string;

  constructor(
    /** DynamoDB document client; typed loosely to avoid duplicate @smithy types across workspace packages. */
    private readonly doc: { send: (command: unknown) => Promise<unknown> },
    private readonly tableName: string,
    options?: DynamoDbMetadataRepositoryOptions,
  ) {
    this.pkAttr = options?.pkAttr ?? 'PK';
    this.skAttr = options?.skAttr ?? 'SK';
  }

  /** Single-table primary key; attribute names must match the table definition. */
  private key(pk: string, sk: string): Record<string, string> {
    return { [this.pkAttr]: pk, [this.skAttr]: sk };
  }

  /** Blocks value writes that would create a new version when the type’s latest version is not ACTIVE. */
  private rethrowDynamo(op: string, e: unknown): never {
    if (!e || typeof e !== 'object') {
      throw e;
    }
    const ex = e as { name?: string; message?: string };
    const name = String(ex.name ?? '');
    const msg = String(ex.message ?? '');
    // AWS SDK v3 often surfaces DynamoDB as Error with message "ValidationException" (name is "Error", not "ValidationException").
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
          `Using env METADATA_REGISTRY_TABLE="${this.tableName}" with key attributes partition="${this.pkAttr}", sort="${this.skAttr}". ` +
          `In the AWS console, the table must define exactly those attribute names for partition + sort keys (both String). ` +
          `If your table uses other names (e.g. pk/sk), set METADATA_REGISTRY_PK_ATTR and METADATA_REGISTRY_SK_ATTR. ` +
          `A table with only a partition key will not work with this service.`,
      );
    }
    throw e;
  }

  /** Wraps TransactWrite with DocumentClient-friendly typing. */
  private async sendTx(items: unknown[]): Promise<void> {
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: items as any }));
    } catch (e: unknown) {
      this.rethrowDynamo('TransactWriteItems', e);
    }
  }

  private listingsPartition(): string {
    return TYPE_INDEX_PK;
  }

  private listingSortKey(metadataTypeCode: string): string {
    return MetadataKeyBuilder.catalogSortKey(metadataTypeCode);
  }

  private dynamoKeyFromItem(item: Record<string, unknown>): Record<string, unknown> {
    const pk = item[this.pkAttr];
    const sk = item[this.skAttr];
    if (typeof pk !== 'string' || typeof sk !== 'string') {
      return {};
    }
    return { [this.pkAttr]: pk, [this.skAttr]: sk };
  }

  /**
   * `METADATA_TYPES` index row: pointers + value counts only. All type fields come from BatchGet on canonical keys.
   * `metadataTypeCode` is omitted; derive from `SK` (`TYPE#<code>`).
   */
  private marshalTypeListingItem(
    metadataTypeCode: string,
    canonicalPk: string,
    canonicalSk: string,
  ): Record<string, unknown> {
    return {
      ...this.key(this.listingsPartition(), this.listingSortKey(metadataTypeCode)),
      canonicalPk,
      canonicalSk,
      [LISTING_COUNTERS_LIST_ATTR]: 0,
      [LISTING_COUNTERS_INACTIVE_ATTR]: 0,
    };
  }

  private typeListingTransactUpdate(
    metadataTypeCode: string,
    canonicalPk: string,
    canonicalSk: string,
  ): unknown {
    return {
      Update: {
        TableName: this.tableName,
        Key: this.key(this.listingsPartition(), this.listingSortKey(metadataTypeCode)),
        UpdateExpression: 'SET #cpk = :cpk, #csk = :csk',
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: {
          '#cpk': 'canonicalPk',
          '#csk': 'canonicalSk',
          '#pk': this.pkAttr,
        },
        ExpressionAttributeValues: {
          ':cpk': canonicalPk,
          ':csk': canonicalSk,
        },
      },
    };
  }

  /** Prefer `SK` = `TYPE#<code>`; fall back to legacy `metadataTypeCode` attr or `canonicalPk`. */
  private listingMetadataTypeCodeFromRow(row: Record<string, unknown>): string | null {
    const sk = row[this.skAttr] as string | undefined;
    const prefix = MetadataKeyBuilder.catalogTypeEntrySortKeyPrefix();
    if (sk && sk.startsWith(prefix) && sk.length > prefix.length) {
      return sk.slice(prefix.length);
    }
    const legacy = row.metadataTypeCode;
    if (typeof legacy === 'string' && legacy.trim() !== '') {
      return legacy.trim();
    }
    const cpk = row.canonicalPk as string | undefined;
    const typePkPrefix = typePartitionKey('');
    if (cpk && cpk.startsWith(typePkPrefix) && cpk.length > typePkPrefix.length) {
      return cpk.slice(typePkPrefix.length);
    }
    return null;
  }

  private valueCounterDeltaTransact(metadataTypeCode: string, dActive: number, dInactive: number): unknown | null {
    if (dActive === 0 && dInactive === 0) {
      return null;
    }
    return {
      Update: {
        TableName: this.tableName,
        Key: this.key(this.listingsPartition(), this.listingSortKey(metadataTypeCode)),
        UpdateExpression: `ADD #a :da, #i :di`,
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: {
          '#a': LISTING_COUNTERS_LIST_ATTR,
          '#i': LISTING_COUNTERS_INACTIVE_ATTR,
          '#pk': this.pkAttr,
        },
        ExpressionAttributeValues: {
          ':da': dActive,
          ':di': dInactive,
        },
      },
    };
  }

  private valueCountDeltasOnCreate(status: Status): { da: number; di: number } {
    return status === STATUS.ACTIVE ? { da: 1, di: 0 } : { da: 0, di: 1 };
  }

  private valueCountDeltasOnStatusChange(before: Status, after: Status): { da: number; di: number } {
    if (before === after) {
      return { da: 0, di: 0 };
    }
    if (before === STATUS.ACTIVE && after === STATUS.INACTIVE) {
      return { da: -1, di: 1 };
    }
    if (before === STATUS.INACTIVE && after === STATUS.ACTIVE) {
      return { da: 1, di: -1 };
    }
    if (before === STATUS.ACTIVE && after === STATUS.DELETED) {
      return { da: -1, di: 0 };
    }
    if (before === STATUS.INACTIVE && after === STATUS.DELETED) {
      return { da: 0, di: -1 };
    }
    return { da: 0, di: 0 };
  }

  private readListingCounts(listingRow: Record<string, unknown>): { active: number; inactive: number } {
    const a = listingRow[LISTING_COUNTERS_LIST_ATTR];
    const i = listingRow[LISTING_COUNTERS_INACTIVE_ATTR];
    return {
      active: typeof a === 'number' ? a : Number(a ?? 0) || 0,
      inactive: typeof i === 'number' ? i : Number(i ?? 0) || 0,
    };
  }

  private passesTypeListFilters(t: MetadataTypeRecord, filter: ListTypesFilter): boolean {
    if (filter.statuses?.length && !filter.statuses.includes(t.status)) {
      return false;
    }
    if (filter.module && !t.applicableModules?.includes(filter.module)) {
      return false;
    }
    if (filter.valueDataType && t.valueDataType !== filter.valueDataType) {
      return false;
    }
    return true;
  }

  private async queryListingPage(
    exclusiveStartKey: Record<string, unknown> | undefined,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    try {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
          ExpressionAttributeNames: { '#pk': this.pkAttr, '#sk': this.skAttr },
          ExpressionAttributeValues: {
            ':pk': this.listingsPartition(),
            ':prefix': MetadataKeyBuilder.catalogTypeEntrySortKeyPrefix(),
          },
          ExclusiveStartKey: exclusiveStartKey,
          Limit: limit,
        }),
      )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
      return { items: res.Items ?? [], lastEvaluatedKey: res.LastEvaluatedKey };
    } catch (e: unknown) {
      this.rethrowDynamo('Query', e);
    }
  }

  private async hydrateListingRowsToEntries(
    listingRows: Record<string, unknown>[],
  ): Promise<(MetadataTypeListEntry | null)[]> {
    if (listingRows.length === 0) {
      return [];
    }
    const keys: Record<string, string>[] = [];
    const schemaTargets: { code: string; pk: string; schemaSkStr: string }[] = [];
    for (const row of listingRows) {
      const cpk = row.canonicalPk as string | undefined;
      const csk = row.canonicalSk as string | undefined;
      const code = this.listingMetadataTypeCodeFromRow(row);
      if (!cpk || !csk || !code) {
        continue;
      }
      keys.push(this.key(cpk, csk));
      if (metadataTypeUsesSeparateSchemaItem(code)) {
        const vm = /^TYPE#METADATA#v(\d+)$/.exec(csk);
        const legacy = csk === LEGACY_TYPE_ENTITY_SK_V1;
        const ver = legacy ? 1 : vm ? parseInt(vm[1]!, 10) : null;
        if (ver !== null) {
          schemaTargets.push({ code, pk: cpk, schemaSkStr: schemaSk(ver) });
        }
      }
    }
    const typeByComposite = new Map<string, Record<string, unknown>>();
    for (const part of chunk(keys, BATCH_GET_SIZE)) {
      try {
        const res = (await this.doc.send(
          new BatchGetCommand({
            RequestItems: { [this.tableName]: { Keys: part } },
          }),
        )) as { Responses?: Record<string, Record<string, unknown>[]> };
        for (const it of res.Responses?.[this.tableName] ?? []) {
          const pk = it[this.pkAttr] as string;
          const sk = it[this.skAttr] as string;
          typeByComposite.set(`${pk}||${sk}`, it);
        }
      } catch (e: unknown) {
        this.rethrowDynamo('BatchGetItem', e);
      }
    }
    const schemaByComposite = new Map<string, Record<string, unknown>>();
    const schemaKeySet = new Set<string>();
    const schemaKeysUnique: Record<string, string>[] = [];
    for (const t of schemaTargets) {
      const comp = `${t.pk}||${t.schemaSkStr}`;
      if (schemaKeySet.has(comp)) {
        continue;
      }
      schemaKeySet.add(comp);
      schemaKeysUnique.push(this.key(t.pk, t.schemaSkStr));
    }
    for (const part of chunk(schemaKeysUnique, BATCH_GET_SIZE)) {
      try {
        const res = (await this.doc.send(
          new BatchGetCommand({
            RequestItems: { [this.tableName]: { Keys: part } },
          }),
        )) as { Responses?: Record<string, Record<string, unknown>[]> };
        for (const it of res.Responses?.[this.tableName] ?? []) {
          const pk = it[this.pkAttr] as string;
          const sk = it[this.skAttr] as string;
          schemaByComposite.set(`${pk}||${sk}`, it);
        }
      } catch (e: unknown) {
        this.rethrowDynamo('BatchGetItem', e);
      }
    }

    return listingRows.map((row): MetadataTypeListEntry | null => {
      const cpk = row.canonicalPk as string | undefined;
      const csk = row.canonicalSk as string | undefined;
      const code = this.listingMetadataTypeCodeFromRow(row);
      if (!cpk || !csk || !code) {
        return null;
      }
      const typeItem = typeByComposite.get(`${cpk}||${csk}`);
      if (!typeItem) {
        return null;
      }
      let sch: Record<string, unknown> | null = null;
      if (metadataTypeUsesSeparateSchemaItem(code)) {
        const vm = /^TYPE#METADATA#v(\d+)$/.exec(csk);
        const legacy = csk === LEGACY_TYPE_ENTITY_SK_V1;
        const ver = legacy ? 1 : vm ? parseInt(vm[1]!, 10) : null;
        if (ver !== null) {
          sch = schemaByComposite.get(`${cpk}||${schemaSk(ver)}`) ?? null;
        }
      }
      const type = this.unmarshalType(typeItem, sch);
      const c = this.readListingCounts(row);
      return { type, activeValueCount: c.active, inactiveValueCount: c.inactive };
    });
  }

  async createMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord> {
    const pk = typePartitionKey(input.metadataTypeCode);
    const existing = await this.getItem(pk, typeEntitySk(1));
    const existingLegacyV1 = existing ? null : await this.getItem(pk, LEGACY_TYPE_ENTITY_SK_V1);
    if (existing || existingLegacyV1) {
      throw new ConflictError(`Metadata type ${input.metadataTypeCode} already exists`);
    }

    const now = new Date().toISOString();
    const version = 1;
    const status = input.status as Status;
    const attributeSchema = resolveAttributeSchemaForMetadataType(
      input.metadataTypeCode,
      input.attributeSchema,
    );
    const supportsRelations = Boolean(input.supportsRelations);
    const record: MetadataTypeRecord = {
      metadataTypeCode: input.metadataTypeCode,
      version,
      displayName: input.displayName!,
      description: input.description,
      valueDataType: input.valueDataType as MetadataTypeRecord['valueDataType'],
      multiSelectAllowed: input.multiSelectAllowed!,
      applicableModules: input.applicableModules ?? [],
      supportsRelations,
      relationFieldLabel: supportsRelations ? String(input.relationFieldLabel ?? '').trim() : null,
      targetMetadataTypeCode: supportsRelations ? String(input.targetMetadataTypeCode ?? '').trim() : null,
      selectionMode: supportsRelations ? input.selectionMode ?? null : null,
      relationRequired: supportsRelations ? input.relationRequired ?? null : null,
      relationType: supportsRelations ? input.relationType ?? null : null,
      valueApplicabilityConfig: input.valueApplicabilityConfig,
      attributeSchema,
      status,
      createdAt: now,
      lastModifiedAt: now,
      createdBy: input.createdBy ?? actor ?? 'system',
      lastModifiedBy: input.lastModifiedBy ?? actor ?? 'system',
    };

    const typeItem = this.marshalType(record, pk, typeEntitySk(version));
    const schemaItem = this.metadataSchemaPutItem(
      input.metadataTypeCode,
      pk,
      version,
      attributeSchema,
    );

    const auditItem = this.buildMetadataTypeAuditItem(auditTypePartitionKey(input.metadataTypeCode), {
      action: 'CREATE',
      changedBy: actor,
      timestamp: now,
      oldValue: {},
      newValue: typeCreateAuditNewValue(record),
    });

    const listingItem = this.marshalTypeListingItem(input.metadataTypeCode, pk, typeEntitySk(version));
    const transactItems = [
      { Put: { TableName: this.tableName, Item: typeItem } },
      { Put: { TableName: this.tableName, Item: auditItem } },
      { Put: { TableName: this.tableName, Item: listingItem } },
    ];
    if (schemaItem) {
      transactItems.splice(1, 0, { Put: { TableName: this.tableName, Item: schemaItem } });
    }

    await this.sendTx(transactItems);
    return record;
  }

  async updateMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord> {
    const existing = await this.getMetadataType(input.metadataTypeCode);
    if (!existing) {
      throw new NotFoundError(`Metadata type ${input.metadataTypeCode} not found`);
    }

    const pk = typePartitionKey(input.metadataTypeCode);
    const currentVersion = (await this.resolveLatestTypeVersion(pk)) ?? existing.version;

    const now = new Date().toISOString();

    /** Every update is a new immutable row `TYPE#METADATA#vN` / `SCHEMA#vN` — never overwrite an existing version. */
    const newVersion = currentVersion + 1;

    const resolvedAttributeSchema = resolveAttributeSchemaForMetadataType(
      input.metadataTypeCode,
      input.attributeSchema,
    );

    /** `input` is the fully merged snapshot from the service layer (PATCH semantics already applied). */
    const supportsRelations = Boolean(input.supportsRelations);
    const record: MetadataTypeRecord = {
      metadataTypeCode: input.metadataTypeCode,
      version: newVersion,
      displayName: input.displayName!,
      description: input.description,
      valueDataType: input.valueDataType as MetadataTypeRecord['valueDataType'],
      multiSelectAllowed: input.multiSelectAllowed!,
      applicableModules: input.applicableModules ?? [],
      supportsRelations,
      relationFieldLabel: supportsRelations ? String(input.relationFieldLabel ?? '').trim() : null,
      targetMetadataTypeCode: supportsRelations ? String(input.targetMetadataTypeCode ?? '').trim() : null,
      selectionMode: supportsRelations ? input.selectionMode ?? null : null,
      relationRequired: supportsRelations ? input.relationRequired ?? null : null,
      relationType: supportsRelations ? input.relationType ?? null : null,
      valueApplicabilityConfig: input.valueApplicabilityConfig,
      attributeSchema: resolvedAttributeSchema,
      status: input.status!,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy ?? input.createdBy,
      lastModifiedAt: now,
      lastModifiedBy: input.lastModifiedBy ?? actor ?? existing.lastModifiedBy,
    };

    const typeItem = this.marshalType(record, pk, typeEntitySk(newVersion));
    const schemaItem = this.metadataSchemaPutItem(
      input.metadataTypeCode,
      pk,
      newVersion,
      resolvedAttributeSchema,
    );

    await this.sendTx([
      { Put: { TableName: this.tableName, Item: typeItem } },
      ...(schemaItem ? [{ Put: { TableName: this.tableName, Item: schemaItem } }] : []),
      {
        Put: {
          TableName: this.tableName,
          Item: this.buildMetadataTypeAuditItem(auditTypePartitionKey(input.metadataTypeCode), {
            action: 'UPDATE',
            changedBy: actor,
            timestamp: now,
            ...getMetadataTypeDelta(existing, record),
          }),
        },
      },
      this.typeListingTransactUpdate(input.metadataTypeCode, pk, typeEntitySk(newVersion)),
    ]);

    return record;
  }

  async updateMetadataTypeInPlace(
    input: MetadataTypeInput,
    actor: string | undefined,
    existing: MetadataTypeRecord,
  ): Promise<MetadataTypeRecord> {
    const pk = typePartitionKey(input.metadataTypeCode);
    const version = existing.version;
    const now = new Date().toISOString();

    const resolvedAttributeSchema = resolveAttributeSchemaForMetadataType(
      input.metadataTypeCode,
      input.attributeSchema,
    );

    const supportsRelations = Boolean(input.supportsRelations);
    const record: MetadataTypeRecord = {
      metadataTypeCode: input.metadataTypeCode,
      version,
      displayName: input.displayName!,
      description: input.description,
      valueDataType: input.valueDataType as MetadataTypeRecord['valueDataType'],
      multiSelectAllowed: input.multiSelectAllowed!,
      applicableModules: input.applicableModules ?? [],
      supportsRelations,
      relationFieldLabel: supportsRelations ? String(input.relationFieldLabel ?? '').trim() : null,
      targetMetadataTypeCode: supportsRelations ? String(input.targetMetadataTypeCode ?? '').trim() : null,
      selectionMode: supportsRelations ? input.selectionMode ?? null : null,
      relationRequired: supportsRelations ? input.relationRequired ?? null : null,
      relationType: supportsRelations ? input.relationType ?? null : null,
      valueApplicabilityConfig: input.valueApplicabilityConfig,
      attributeSchema: resolvedAttributeSchema,
      status: input.status!,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy ?? input.createdBy,
      lastModifiedAt: now,
      lastModifiedBy: input.lastModifiedBy ?? actor ?? existing.lastModifiedBy,
    };

    const typeItem = this.marshalType(record, pk, typeEntitySk(version));
    const schemaUnchanged =
      JSON.stringify(existing.attributeSchema ?? null) === JSON.stringify(resolvedAttributeSchema ?? null);
    const schemaItem =
      !schemaUnchanged && resolvedAttributeSchema !== undefined
        ? this.metadataSchemaPutItem(input.metadataTypeCode, pk, version, resolvedAttributeSchema)
        : null;

    await this.sendTx([
      { Put: { TableName: this.tableName, Item: typeItem } },
      ...(schemaItem ? [{ Put: { TableName: this.tableName, Item: schemaItem } }] : []),
      {
        Put: {
          TableName: this.tableName,
          Item: this.buildMetadataTypeAuditItem(auditTypePartitionKey(input.metadataTypeCode), {
            action: 'UPDATE',
            changedBy: actor,
            timestamp: now,
            ...getMetadataTypeDelta(existing, record),
          }),
        },
      },
    ]);

    return record;
  }

  async patchMetadataTypeStatus(metadataTypeCode: string, status: Status, actor?: string): Promise<MetadataTypeRecord> {
    const existing = await this.getMetadataType(metadataTypeCode);
    if (!existing) {
      throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
    }
    const pk = typePartitionKey(metadataTypeCode);
    const currentVersion = (await this.resolveLatestTypeVersion(pk)) ?? existing.version;
    const newVersion = currentVersion + 1;
    const now = new Date().toISOString();
    const record: MetadataTypeRecord = {
      ...existing,
      version: newVersion,
      status,
      lastModifiedAt: now,
      lastModifiedBy: actor,
    };

    const typeItem = this.marshalType(record, pk, typeEntitySk(newVersion));
    const schemaCopy =
      existing.attributeSchema !== undefined && metadataTypeUsesSeparateSchemaItem(metadataTypeCode)
        ? this.metadataSchemaPutItem(metadataTypeCode, pk, newVersion, existing.attributeSchema)
        : null;

    await this.sendTx([
      { Put: { TableName: this.tableName, Item: typeItem } },
      ...(schemaCopy ? [{ Put: { TableName: this.tableName, Item: schemaCopy } }] : []),
      {
        Put: {
          TableName: this.tableName,
          Item: this.buildMetadataTypeAuditItem(auditTypePartitionKey(metadataTypeCode), {
            action: 'UPDATE',
            changedBy: actor,
            timestamp: now,
            ...getMetadataTypeDelta(existing, record),
          }),
        },
      },
      this.typeListingTransactUpdate(metadataTypeCode, pk, typeEntitySk(newVersion)),
    ]);

    return record;
  }

  async getMetadataType(metadataTypeCode: string): Promise<MetadataTypeRecord | null> {
    const pk = typePartitionKey(metadataTypeCode);
    const v = await this.resolveLatestTypeVersion(pk);
    if (v === null) {
      return null;
    }
    let typeItem = await this.getItem(pk, typeEntitySk(v));
    if (!typeItem && v === 1) {
      typeItem = await this.getItem(pk, LEGACY_TYPE_ENTITY_SK_V1);
    }
    if (!typeItem) {
      return null;
    }
    const schemaItem =
      metadataTypeUsesSeparateSchemaItem(metadataTypeCode) ? await this.getItem(pk, schemaSk(v)) : null;
    return this.unmarshalType(typeItem, schemaItem);
  }

  async listMetadataTypes(filter: ListTypesFilter): Promise<MetadataTypeListEntry[]> {
    const results: MetadataTypeListEntry[] = [];
    let eks: Record<string, unknown> | undefined;
    do {
      const page = await this.queryListingPage(eks, TYPE_LIST_FETCH_SIZE);
      eks = page.lastEvaluatedKey;
      if (page.items.length === 0) {
        continue;
      }
      const hydrated = await this.hydrateListingRowsToEntries(page.items);
      for (const entry of hydrated) {
        if (!entry || !this.passesTypeListFilters(entry.type, filter)) {
          continue;
        }
        results.push(entry);
      }
    } while (eks);
    return results.sort((a, b) =>
      a.type.metadataTypeCode.localeCompare(b.type.metadataTypeCode),
    );
  }

  async listMetadataTypesPaginated(
    filter: ListTypesFilter,
    options: ListMetadataTypesPaginatedOptions,
  ): Promise<{ entries: MetadataTypeListEntry[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const out: MetadataTypeListEntry[] = [];
    let resumeDynamoKey: Record<string, unknown> | undefined = options.exclusiveStartKey;
    let nextClientKey: Record<string, unknown> | undefined;

    for (let rounds = 0; rounds < MAX_PAGE_ROUNDS && out.length < options.limit; rounds++) {
      const page = await this.queryListingPage(resumeDynamoKey, TYPE_LIST_FETCH_SIZE);

      if (page.items.length === 0) {
        resumeDynamoKey = page.lastEvaluatedKey;
        if (!resumeDynamoKey) {
          break;
        }
        continue;
      }

      const hydrated = await this.hydrateListingRowsToEntries(page.items);
      for (let i = 0; i < hydrated.length; i++) {
        const entry = hydrated[i];
        const listingRow = page.items[i];
        if (!entry || !listingRow || !this.passesTypeListFilters(entry.type, filter)) {
          continue;
        }
        out.push(entry);
        if (out.length >= options.limit) {
          nextClientKey = this.dynamoKeyFromItem(listingRow);
          break;
        }
      }

      if (out.length >= options.limit) {
        break;
      }

      resumeDynamoKey = page.lastEvaluatedKey;
      if (!resumeDynamoKey) {
        break;
      }
    }

    return {
      entries: out,
      lastEvaluatedKey:
        out.length === options.limit &&
        nextClientKey &&
        Object.keys(nextClientKey).length > 0
          ? nextClientKey
          : undefined,
    };
  }

  async createMetadataValue(metadataTypeCode: string, input: MetadataValueInput, actor?: string): Promise<MetadataValueRecord> {
    const pk = typePartitionKey(metadataTypeCode);
    const latest = await this.getItem(pk, valueLatestSk(input.valueCode));
    if (latest) {
      throw new ConflictError(`Value ${input.valueCode} already exists`);
    }

    const now = new Date().toISOString();
    const version = 1;
    const status = input.status as Status;
    const record: MetadataValueRecord = {
      metadataTypeCode,
      valueCode: input.valueCode,
      version,
      label: input.label,
      description: input.description,
      sortOrder: input.sortOrder ?? 0,
      status,
      isGlobal: input.isGlobal!,
      attributes: input.attributes ?? {},
      applicability: input.applicability,
      applSkKeys: [],
      createdAt: now,
      lastModifiedAt: now,
      createdBy: actor,
      lastModifiedBy: actor,
    };

    const applKeys = record.isGlobal ? [] : buildApplSortKeys(input.valueCode, input.applicability);
    record.applSkKeys = applKeys;

    const valueItem = this.marshalValue(record, pk, valueSk(input.valueCode, version));
    const latestPointer = {
      ...this.key(pk, valueLatestSk(input.valueCode)),
      entityType: 'VALUE_LATEST',
      valueCode: input.valueCode,
      latestVersion: version,
    };

    const auditItem = this.buildMetadataValueAuditItem(auditValuePartitionKey(input.valueCode), {
      action: 'CREATE',
      changedBy: actor,
      timestamp: now,
      oldValue: {},
      newValue: valueCreateAuditNewValue(record),
    });

    const { da, di } = this.valueCountDeltasOnCreate(status);
    const ctr = this.valueCounterDeltaTransact(metadataTypeCode, da, di);
    await this.sendTx([
      { Put: { TableName: this.tableName, Item: valueItem } },
      { Put: { TableName: this.tableName, Item: latestPointer } },
      { Put: { TableName: this.tableName, Item: auditItem } },
      ...(ctr ? [ctr] : []),
    ]);

    await this.writeApplRows(pk, applKeys, metadataTypeCode, input.valueCode);
    return record;
  }

  async updateMetadataValue(
    metadataTypeCode: string,
    input: MetadataValueInput,
    actor: string | undefined,
    existing: MetadataValueRecord,
  ): Promise<MetadataValueRecord> {
    if (existing.status === STATUS.DELETED) {
      throw new ConflictError(`Value ${input.valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
    }
    const mergedIsGlobal = input.isGlobal ?? existing.isGlobal;

    const pk = typePartitionKey(metadataTypeCode);
    const newVersion = existing.version + 1;
    const now = new Date().toISOString();
    const status = input.status as Status;
    const isGlobal = mergedIsGlobal;
    const attributes = input.attributes !== undefined ? input.attributes : existing.attributes;
    const description = input.description !== undefined ? input.description : existing.description;
    const sortOrder = input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder;

    const record: MetadataValueRecord = {
      ...existing,
      version: newVersion,
      label: input.label,
      description,
      sortOrder: sortOrder ?? 0,
      status,
      isGlobal,
      attributes: attributes ?? {},
      applicability: input.applicability,
      applSkKeys: isGlobal ? [] : buildApplSortKeys(input.valueCode, input.applicability),
      lastModifiedAt: now,
      lastModifiedBy: actor,
    };

    const valueItem = this.marshalValue(record, pk, valueSk(input.valueCode, newVersion));
    const latestPointer = {
      ...this.key(pk, valueLatestSk(input.valueCode)),
      entityType: 'VALUE_LATEST',
      valueCode: input.valueCode,
      latestVersion: newVersion,
    };

    const { da, di } = this.valueCountDeltasOnStatusChange(existing.status, record.status);
    const ctr = this.valueCounterDeltaTransact(metadataTypeCode, da, di);
    await this.sendTx([
      { Put: { TableName: this.tableName, Item: valueItem } },
      { Put: { TableName: this.tableName, Item: latestPointer } },
      {
        Put: {
          TableName: this.tableName,
          Item: this.buildMetadataValueAuditItem(auditValuePartitionKey(input.valueCode), {
            action: resolveValueUpdateAction(metadataTypeCode, existing, record),
            changedBy: actor,
            timestamp: now,
            ...getMetadataValueDelta(existing, record),
          }),
        },
      },
      ...(ctr ? [ctr] : []),
    ]);

    await this.syncApplRows(pk, existing.applSkKeys, record.applSkKeys, metadataTypeCode, input.valueCode);
    return record;
  }

  async updateMetadataValueInPlace(
    metadataTypeCode: string,
    input: MetadataValueInput,
    actor: string | undefined,
    existing: MetadataValueRecord,
    options: { syncApplicability: boolean },
  ): Promise<MetadataValueRecord> {
    if (existing.status === STATUS.DELETED) {
      throw new ConflictError(`Value ${input.valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
    }
    const mergedIsGlobal = input.isGlobal ?? existing.isGlobal;
    const pk = typePartitionKey(metadataTypeCode);
    const version = existing.version;
    const now = new Date().toISOString();
    const status = input.status as Status;
    const isGlobal = mergedIsGlobal;
    const attributes = input.attributes !== undefined ? input.attributes : existing.attributes;
    const description = input.description !== undefined ? input.description : existing.description;
    const sortOrder = input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder;
    const applicability = options.syncApplicability ? input.applicability : existing.applicability;
    const applSkKeys = options.syncApplicability
      ? isGlobal
        ? []
        : buildApplSortKeys(input.valueCode, input.applicability)
      : existing.applSkKeys;

    const record: MetadataValueRecord = {
      ...existing,
      version,
      label: input.label,
      description,
      sortOrder: sortOrder ?? 0,
      status,
      isGlobal,
      attributes: attributes ?? {},
      applicability,
      applSkKeys,
      lastModifiedAt: now,
      lastModifiedBy: actor,
    };

    const valueItem = this.marshalValue(record, pk, valueSk(input.valueCode, version));
    const { da, di } = this.valueCountDeltasOnStatusChange(existing.status, record.status);
    const ctr = this.valueCounterDeltaTransact(metadataTypeCode, da, di);
    await this.sendTx([
      { Put: { TableName: this.tableName, Item: valueItem } },
      {
        Put: {
          TableName: this.tableName,
          Item: this.buildMetadataValueAuditItem(auditValuePartitionKey(input.valueCode), {
            action: resolveValueUpdateAction(metadataTypeCode, existing, record),
            changedBy: actor,
            timestamp: now,
            ...getMetadataValueDelta(existing, record),
          }),
        },
      },
      ...(ctr ? [ctr] : []),
    ]);

    if (options.syncApplicability) {
      await this.syncApplRows(pk, existing.applSkKeys, record.applSkKeys, metadataTypeCode, input.valueCode);
    }

    return record;
  }

  async patchMetadataValueStatus(metadataTypeCode: string, valueCode: string, status: Status, actor?: string): Promise<MetadataValueRecord> {
    const existing = await this.getMetadataValue(metadataTypeCode, valueCode);
    if (!existing) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    if (existing.status === STATUS.DELETED) {
      throw new ConflictError(`Value ${valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
    }
    if (!(await this.getMetadataType(metadataTypeCode))) {
      throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
    }

    const pk = typePartitionKey(metadataTypeCode);
    const newVersion = existing.version + 1;
    const now = new Date().toISOString();
    const record: MetadataValueRecord = {
      ...existing,
      version: newVersion,
      status,
      lastModifiedAt: now,
      lastModifiedBy: actor,
    };

    const valueItem = this.marshalValue(record, pk, valueSk(valueCode, newVersion));
    const latestPointer = {
      ...this.key(pk, valueLatestSk(valueCode)),
      entityType: 'VALUE_LATEST',
      valueCode,
      latestVersion: newVersion,
    };

    const { da, di } = this.valueCountDeltasOnStatusChange(existing.status, record.status);
    const ctr = this.valueCounterDeltaTransact(metadataTypeCode, da, di);
    await this.sendTx([
      { Put: { TableName: this.tableName, Item: valueItem } },
      { Put: { TableName: this.tableName, Item: latestPointer } },
      {
        Put: {
          TableName: this.tableName,
          Item: this.buildMetadataValueAuditItem(auditValuePartitionKey(valueCode), {
            action: 'UPDATE',
            changedBy: actor,
            timestamp: now,
            ...getMetadataValueDelta(existing, record),
          }),
        },
      },
      ...(ctr ? [ctr] : []),
    ]);

    return record;
  }

  async softDeleteMetadataValue(
    metadataTypeCode: string,
    valueCode: string,
    opts: { reason?: string; actor?: string },
  ): Promise<MetadataValueRecord> {
    const existing = await this.getMetadataValue(metadataTypeCode, valueCode);
    if (!existing) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    if (existing.status === STATUS.DELETED) {
      throw new ConflictError(`Value ${valueCode} is already deleted`, 'VALUE_ALREADY_DELETED');
    }
    if (!(await this.getMetadataType(metadataTypeCode))) {
      throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
    }

    const pk = typePartitionKey(metadataTypeCode);
    const newVersion = existing.version + 1;
    const now = new Date().toISOString();
    const previousStatus = existing.status;

    const record: MetadataValueRecord = {
      ...existing,
      version: newVersion,
      status: STATUS.DELETED,
      previousStatus,
      deletedAt: now,
      deletedBy: opts.actor,
      deleteReason: opts.reason !== undefined && String(opts.reason).trim() !== '' ? String(opts.reason).trim() : undefined,
      lastModifiedAt: now,
      lastModifiedBy: opts.actor,
    };

    const valueItem = this.marshalValue(record, pk, valueSk(valueCode, newVersion));
    const latestPointer = {
      ...this.key(pk, valueLatestSk(valueCode)),
      entityType: 'VALUE_LATEST',
      valueCode,
      latestVersion: newVersion,
      status: STATUS.DELETED,
      updatedAt: now,
    };

    const auditPayload: Record<string, unknown> = {
      changeType: 'SOFT_DELETED',
      previousStatus,
      newStatus: STATUS.DELETED,
      changedBy: opts.actor,
      changedAt: now,
    };
    if (record.deleteReason !== undefined) {
      auditPayload.changeReason = record.deleteReason;
    }

    const auditItem = this.buildMetadataValueAuditItem(auditValuePartitionKey(valueCode), {
      action: 'STATUS',
      changedBy: opts.actor,
      timestamp: now,
      oldValue: { status: previousStatus },
      newValue: auditPayload,
    });

    const { da, di } = this.valueCountDeltasOnStatusChange(existing.status, STATUS.DELETED);
    const ctr = this.valueCounterDeltaTransact(metadataTypeCode, da, di);
    await this.sendTx([
      { Put: { TableName: this.tableName, Item: valueItem } },
      { Put: { TableName: this.tableName, Item: latestPointer } },
      { Put: { TableName: this.tableName, Item: auditItem } },
      ...(ctr ? [ctr] : []),
    ]);

    return record;
  }

  async getMetadataValue(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord | null> {
    const pk = typePartitionKey(metadataTypeCode);
    const latest = await this.getItem(pk, valueLatestSk(valueCode));
    if (!latest || latest.entityType !== 'VALUE_LATEST') {
      return null;
    }
    const v = latest.latestVersion as number;
    const valueItem = await this.getItem(pk, valueSk(valueCode, v));
    if (!valueItem) {
      return null;
    }
    return this.unmarshalValue(valueItem);
  }

  async listMetadataValues(
    metadataTypeCode: string,
    statuses: Status[],
  ): Promise<MetadataValueRecord[]> {
    const pk = typePartitionKey(metadataTypeCode);
    const rows = await this.queryAll(pk, MetadataKeyBuilder.valueLatestSortKeyPrefix());
    const codes = rows
      .filter((r) => r.entityType === 'VALUE_LATEST')
      .map((r) => r.valueCode as string)
      .filter(Boolean);

    const values = await this.batchLoadValues(pk, codes);
    return values.filter((v) => this.valuePassesLifecycleStatus(v, statuses));
  }

  async listMetadataValuesPaginated(
    metadataTypeCode: string,
    statuses: Status[],
    options: ListMetadataValuesPaginatedOptions,
  ): Promise<{ records: MetadataValueRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const pk = typePartitionKey(metadataTypeCode);
    const out: MetadataValueRecord[] = [];
    let resumeDynamoKey: Record<string, unknown> | undefined = options.exclusiveStartKey;
    let nextClientKey: Record<string, unknown> | undefined;

    for (let rounds = 0; rounds < MAX_PAGE_ROUNDS && out.length < options.limit; rounds++) {
      const page = await this.queryValueLatestPage(pk, resumeDynamoKey, VALUE_LIST_FETCH_SIZE);

      const pointers = (page.items ?? []).filter(
        (r) => r.entityType === 'VALUE_LATEST' && typeof r.valueCode === 'string',
      );
      if (pointers.length === 0) {
        resumeDynamoKey = page.lastEvaluatedKey;
        if (!resumeDynamoKey) {
          break;
        }
        continue;
      }

      const codes = pointers.map((r) => r.valueCode as string);
      const vals = await this.batchLoadValues(pk, codes);
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]!;
        if (!this.valuePassesLifecycleStatus(v, statuses)) {
          continue;
        }
        out.push(v);
        if (out.length >= options.limit) {
          nextClientKey = this.dynamoKeyFromItem(pointers[i]!);
          break;
        }
      }

      if (out.length >= options.limit) {
        break;
      }

      resumeDynamoKey = page.lastEvaluatedKey;
      if (!resumeDynamoKey) {
        break;
      }
    }

    return {
      records: out,
      lastEvaluatedKey:
        out.length === options.limit &&
        nextClientKey &&
        Object.keys(nextClientKey).length > 0
          ? nextClientKey
          : undefined,
    };
  }

  async searchMetadataValues(metadataTypeCode: string, filter: ValueSearchFilter): Promise<MetadataValueRecord[]> {
    const pk = typePartitionKey(metadataTypeCode);
    const applRows = await this.queryAll(pk, MetadataKeyBuilder.applSortKeyPrefix());
    const fromAppl = new Set<string>();
    for (const r of applRows) {
      const sk = r[this.skAttr] as string;
      const code = extractValueCodeFromApplSk(sk);
      if (code) {
        fromAppl.add(code);
      }
    }

    const latestRows = await this.queryAll(pk, MetadataKeyBuilder.valueLatestSortKeyPrefix());
    const allCodes = new Set<string>();
    for (const r of latestRows) {
      if (r.entityType === 'VALUE_LATEST' && r.valueCode) {
        allCodes.add(r.valueCode as string);
      }
    }
    fromAppl.forEach((c) => allCodes.add(c));

    const values = await this.batchLoadValues(pk, [...allCodes]);
    const matched = values.filter((v) => matchesSearchFilter(v, filter, [STATUS.ACTIVE]));
    return sortValuesForSearch(matched);
  }

  async listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]> {
    const rows = await this.queryAll(auditTypePartitionKey(metadataTypeCode), MetadataKeyBuilder.auditTimestampSortKeyPrefix());
    const legacyPk = typePartitionKey(metadataTypeCode);
    const legacyPrefix = MetadataKeyBuilder.legacyTypeAuditSkPrefixOnTypePartition(metadataTypeCode);
    const legacyRows = await this.queryAll(legacyPk, legacyPrefix);
    const merged = [...rows, ...legacyRows];
    return merged
      .filter((r) => r.entityType === 'AUDIT')
      .map((r) => this.unmarshalAudit(r))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]> {
    const rows = await this.queryAll(auditValuePartitionKey(valueCode), MetadataKeyBuilder.auditTimestampSortKeyPrefix());
    const legacyPk = typePartitionKey(metadataTypeCode);
    const legacyPrefix = MetadataKeyBuilder.legacyValueAuditSkPrefixOnTypePartition(valueCode);
    const legacyRows = await this.queryAll(legacyPk, legacyPrefix);
    const merged = [...rows, ...legacyRows];
    return merged
      .filter((r) => r.entityType === 'AUDIT')
      .map((r) => this.unmarshalAudit(r))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // --- helpers ---

  /**
   * Persisted `SCHEMA#vN` rows only for MetricCode and QuestionCode; payload field `attributeSchema` per access pattern.
   */
  private metadataSchemaPutItem(
    metadataTypeCode: string,
    pk: string,
    version: number,
    attributeSchema: Record<string, unknown> | undefined,
  ): Record<string, unknown> | null {
    if (!metadataTypeUsesSeparateSchemaItem(metadataTypeCode) || attributeSchema === undefined) {
      return null;
    }
    return {
      ...this.key(pk, schemaSk(version)),
      entityType: 'METADATA_TYPE_SCHEMA',
      version,
      attributeSchema,
    };
  }

  /**
   * Latest type version: legacy `TYPE_LATEST#METADATA` if present, else max version from `TYPE#METADATA*` rows.
   */
  private async resolveLatestTypeVersion(pk: string): Promise<number | null> {
    const legacy = await this.getLegacyTypeLatestPointer(pk);
    if (legacy) {
      return legacy.latestVersion;
    }
    const rows = await this.queryAll(pk, MetadataKeyBuilder.typeMetadataFamilySortKeyPrefix());
    let max = 0;
    for (const r of rows) {
      const sk = r[this.skAttr] as string;
      if (sk === LEGACY_TYPE_ENTITY_SK_V1) {
        max = Math.max(max, 1);
        continue;
      }
      const m = /^TYPE#METADATA#v(\d+)$/.exec(sk);
      if (m) {
        max = Math.max(max, parseInt(m[1], 10));
      }
    }
    return max > 0 ? max : null;
  }

  /** Read-only: old deployments may still have this item; new writes omit it. */
  private async getLegacyTypeLatestPointer(pk: string): Promise<{ latestVersion: number } | null> {
    const item = await this.getItem(pk, typeLatestPointerSk());
    if (!item || item.entityType !== 'TYPE_LATEST') {
      return null;
    }
    return { latestVersion: item.latestVersion as number };
  }

  private async getItem(pk: string, sk: string): Promise<Record<string, unknown> | null> {
    try {
      const res = (await this.doc.send(
        new GetCommand({ TableName: this.tableName, Key: this.key(pk, sk) }),
      )) as { Item?: Record<string, unknown> };
      return (res.Item as Record<string, unknown>) ?? null;
    } catch (e: unknown) {
      this.rethrowDynamo('GetItem', e);
    }
  }

  private async queryAll(pk: string, skPrefix: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      try {
        const res = (await this.doc.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
            ExpressionAttributeNames: { '#pk': this.pkAttr, '#sk': this.skAttr },
            ExpressionAttributeValues: { ':pk': pk, ':prefix': skPrefix },
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

  private async batchLoadValues(pk: string, valueCodes: string[]): Promise<MetadataValueRecord[]> {
    if (valueCodes.length === 0) {
      return [];
    }
    const latestMap = new Map<string, number>();
    const chunks = chunk(valueCodes, BATCH_GET_SIZE);
    for (const part of chunks) {
      try {
        const keys = part.map((code) => this.key(pk, valueLatestSk(code)));
        const res = (await this.doc.send(
          new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: keys } } }),
        )) as { Responses?: Record<string, Record<string, unknown>[]> };
        const items = res.Responses?.[this.tableName] ?? [];
        for (const it of items) {
          const code = it.valueCode as string;
          latestMap.set(code, it.latestVersion as number);
        }
      } catch (e: unknown) {
        this.rethrowDynamo('BatchGetItem', e);
      }
    }

    const valueKeys: { pk: string; sk: string; code: string }[] = [];
    for (const code of valueCodes) {
      const ver = latestMap.get(code);
      if (ver !== undefined) {
        valueKeys.push({ pk, sk: valueSk(code, ver), code });
      }
    }

    const byCode = new Map<string, MetadataValueRecord>();
    for (const part of chunk(valueKeys, BATCH_GET_SIZE)) {
      try {
        const res = (await this.doc.send(
          new BatchGetCommand({
            RequestItems: { [this.tableName]: { Keys: part.map((k) => this.key(k.pk, k.sk)) } },
          }),
        )) as { Responses?: Record<string, Record<string, unknown>[]> };
        const items = res.Responses?.[this.tableName] ?? [];
        for (const it of items) {
          const rec = this.unmarshalValue(it as Record<string, unknown>);
          byCode.set(rec.valueCode, rec);
        }
      } catch (e: unknown) {
        this.rethrowDynamo('BatchGetItem', e);
      }
    }
    return valueCodes.map((c) => byCode.get(c)).filter((v): v is MetadataValueRecord => v !== undefined);
  }

  private valuePassesLifecycleStatus(v: MetadataValueRecord, statuses: Status[]): boolean {
    return statuses.includes(v.status);
  }

  private async queryValueLatestPage(
    pk: string,
    exclusiveStartKey: Record<string, unknown> | undefined,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    try {
      const res = (await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
          ExpressionAttributeNames: { '#pk': this.pkAttr, '#sk': this.skAttr },
          ExpressionAttributeValues: { ':pk': pk, ':prefix': MetadataKeyBuilder.valueLatestSortKeyPrefix() },
          ExclusiveStartKey: exclusiveStartKey,
          Limit: limit,
        }),
      )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
      return { items: res.Items ?? [], lastEvaluatedKey: res.LastEvaluatedKey };
    } catch (e: unknown) {
      this.rethrowDynamo('Query', e);
    }
  }

  private async writeApplRows(pk: string, keys: string[], metadataTypeCode: string, valueCode: string): Promise<void> {
    for (const part of chunk(keys, BATCH_WRITE_SIZE)) {
      const requests = part.map((sk) => ({
        PutRequest: {
          Item: {
            ...this.key(pk, sk),
            entityType: 'APPL',
            metadataTypeCode,
            valueCode,
          },
        },
      }));
      try {
        await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } }));
      } catch (e: unknown) {
        this.rethrowDynamo('BatchWriteItem', e);
      }
    }
  }

  private async deleteApplRows(pk: string, keys: string[]): Promise<void> {
    for (const part of chunk(keys, BATCH_WRITE_SIZE)) {
      const requests = part.map((sk) => ({
        DeleteRequest: { Key: this.key(pk, sk) },
      }));
      try {
        await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } }));
      } catch (e: unknown) {
        this.rethrowDynamo('BatchWriteItem', e);
      }
    }
  }

  private async syncApplRows(
    pk: string,
    before: string[],
    after: string[],
    metadataTypeCode: string,
    valueCode: string,
  ): Promise<void> {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const toDelete = [...beforeSet].filter((k) => !afterSet.has(k));
    const toAdd = [...afterSet].filter((k) => !beforeSet.has(k));
    if (toDelete.length) {
      await this.deleteApplRows(pk, toDelete);
    }
    if (toAdd.length) {
      await this.writeApplRows(pk, toAdd, metadataTypeCode, valueCode);
    }
  }

  private marshalType(r: MetadataTypeRecord, pk: string, sk: string): Record<string, unknown> {
    return {
      ...this.key(pk, sk),
      entityType: ENTITY_TYPE.METADATA_TYPE,
      metadataTypeCode: r.metadataTypeCode,
      version: r.version,
      displayName: r.displayName,
      description: r.description,
      applicableModules: r.applicableModules,
      valueDataType: r.valueDataType,
      multiSelectAllowed: r.multiSelectAllowed,
      supportsRelations: r.supportsRelations,
      ...(r.relationFieldLabel != null ? { relationFieldLabel: r.relationFieldLabel } : {}),
      ...(r.targetMetadataTypeCode != null ? { targetMetadataTypeCode: r.targetMetadataTypeCode } : {}),
      ...(r.selectionMode != null ? { selectionMode: r.selectionMode } : {}),
      ...(r.relationRequired != null ? { relationRequired: r.relationRequired } : {}),
      ...(r.relationType != null ? { relationType: r.relationType } : {}),
      status: r.status,
      createdAt: r.createdAt,
      lastModifiedAt: r.lastModifiedAt,
      createdBy: r.createdBy,
      lastModifiedBy: r.lastModifiedBy,
      ...(r.valueApplicabilityConfig ? { valueApplicabilityConfig: r.valueApplicabilityConfig } : {}),
    };
  }

  private unmarshalType(typeItem: Record<string, unknown>, schemaItem: Record<string, unknown> | null): MetadataTypeRecord {
    const legacyName = typeItem.name as string | undefined;
    const legacyModule = typeItem.module as string | undefined;
    const legacyDatatype = typeItem.datatype as string | undefined;
    const displayName = (typeItem.displayName ?? legacyName ?? '') as string;
    const applicableModules =
      (typeItem.applicableModules as string[] | undefined) ?? (legacyModule ? [legacyModule] : []);
    const valueDataType = (typeItem.valueDataType ?? legacyDatatype ?? 'Text') as MetadataTypeRecord['valueDataType'];
    const multiSelectAllowed =
      typeItem.multiSelectAllowed !== undefined ? Boolean(typeItem.multiSelectAllowed) : false;
    const lastModifiedAt = (typeItem.lastModifiedAt ?? typeItem.updatedAt ?? typeItem.createdAt) as string;
    const lastModifiedBy = (typeItem.lastModifiedBy ?? typeItem.updatedBy) as string | undefined;

    const supportsRelations =
      typeItem.supportsRelations !== undefined ? Boolean(typeItem.supportsRelations) : false;

    return {
      metadataTypeCode: typeItem.metadataTypeCode as string,
      version: typeItem.version as number,
      displayName,
      description: typeItem.description as string | undefined,
      valueDataType,
      multiSelectAllowed,
      applicableModules,
      supportsRelations,
      relationFieldLabel: (typeItem.relationFieldLabel ?? null) as string | null,
      targetMetadataTypeCode: (typeItem.targetMetadataTypeCode ?? null) as string | null,
      selectionMode: (typeItem.selectionMode ?? null) as MetadataTypeRecord['selectionMode'],
      relationRequired:
        typeItem.relationRequired !== undefined && typeItem.relationRequired !== null
          ? Boolean(typeItem.relationRequired)
          : null,
      relationType: (typeItem.relationType ?? null) as MetadataTypeRecord['relationType'],
      valueApplicabilityConfig: typeItem.valueApplicabilityConfig as MetadataTypeRecord['valueApplicabilityConfig'],
      attributeSchema: schemaItem
        ? ((schemaItem.attributeSchema ?? schemaItem.schema) as Record<string, unknown>)
        : undefined,
      status: typeItem.status as Status,
      createdAt: typeItem.createdAt as string,
      lastModifiedAt,
      createdBy: typeItem.createdBy as string | undefined,
      lastModifiedBy,
    };
  }

  private marshalValue(r: MetadataValueRecord, pk: string, sk: string): Record<string, unknown> {
    return {
      ...this.key(pk, sk),
      entityType: ENTITY_TYPE.METADATA_VALUE,
      metadataTypeCode: r.metadataTypeCode,
      valueCode: r.valueCode,
      version: r.version,
      label: r.label,
      ...(r.description !== undefined ? { description: r.description } : {}),
      sortOrder: r.sortOrder,
      status: r.status,
      isGlobal: r.isGlobal,
      attributes: r.attributes,
      applicability: r.applicability,
      applSkKeys: r.applSkKeys,
      createdAt: r.createdAt,
      lastModifiedAt: r.lastModifiedAt,
      createdBy: r.createdBy,
      lastModifiedBy: r.lastModifiedBy,
      ...(r.deletedAt !== undefined ? { deletedAt: r.deletedAt } : {}),
      ...(r.deletedBy !== undefined ? { deletedBy: r.deletedBy } : {}),
      ...(r.deleteReason !== undefined ? { deleteReason: r.deleteReason } : {}),
      ...(r.previousStatus !== undefined ? { previousStatus: r.previousStatus } : {}),
    };
  }

  private unmarshalValue(item: Record<string, unknown>): MetadataValueRecord {
    const lastModifiedAt =
      (item.lastModifiedAt as string | undefined) ?? (item.updatedAt as string | undefined) ?? '';
    const lastModifiedBy =
      (item.lastModifiedBy as string | undefined) ?? (item.updatedBy as string | undefined);
    return {
      metadataTypeCode: item.metadataTypeCode as string,
      valueCode: item.valueCode as string,
      version: item.version as number,
      label: item.label as string,
      description: item.description as string | undefined,
      sortOrder: (item.sortOrder as number) ?? 0,
      status: item.status as Status,
      isGlobal: Boolean(item.isGlobal),
      attributes: (item.attributes as Record<string, unknown>) ?? {},
      applicability: item.applicability as Applicability,
      applSkKeys: (item.applSkKeys as string[]) ?? [],
      createdAt: item.createdAt as string,
      lastModifiedAt,
      createdBy: item.createdBy as string | undefined,
      lastModifiedBy,
      ...(item.deletedAt !== undefined ? { deletedAt: item.deletedAt as string } : {}),
      ...(item.deletedBy !== undefined ? { deletedBy: item.deletedBy as string } : {}),
      ...(item.deleteReason !== undefined ? { deleteReason: item.deleteReason as string } : {}),
      ...(item.previousStatus !== undefined ? { previousStatus: item.previousStatus as Status } : {}),
    };
  }

  /**
   * Type audit event log: delta only. PK `AUDIT#METADATA_TYPE#<metadataTypeCode>`, SK `TIMESTAMP#<iso>#<ulid>`.
   */
  private buildMetadataTypeAuditItem(
    auditPk: string,
    params: {
      action: 'CREATE' | 'UPDATE';
      changedBy?: string;
      timestamp: string;
      oldValue: Record<string, unknown>;
      newValue: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const id = ulid();
    const sk = MetadataKeyBuilder.auditTimestampSk(params.timestamp, id);
    return {
      ...this.key(auditPk, sk),
      entityType: 'AUDIT',
      entity: 'METADATA_TYPE',
      auditId: id,
      eventId: id,
      action: params.action,
      changedBy: params.changedBy,
      timestamp: params.timestamp,
      oldValue: params.oldValue,
      newValue: params.newValue,
    };
  }

  /**
   * Value audit event log: delta only (`oldValue` / `newValue`), no full snapshots.
   * PK `AUDIT#METADATA_VALUE#<valueCode>`, SK `TIMESTAMP#<iso>#<ulid>`.
   */
  private buildMetadataValueAuditItem(
    auditPk: string,
    params: {
      action: 'CREATE' | 'UPDATE' | 'UPDATE_BREAKING' | 'STATUS';
      changedBy?: string;
      timestamp: string;
      oldValue: Record<string, unknown>;
      newValue: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const id = ulid();
    const sk = MetadataKeyBuilder.auditTimestampSk(params.timestamp, id);
    return {
      ...this.key(auditPk, sk),
      entityType: 'AUDIT',
      entity: 'METADATA_VALUE',
      auditId: id,
      eventId: id,
      action: params.action,
      changedBy: params.changedBy,
      timestamp: params.timestamp,
      oldValue: params.oldValue,
      newValue: params.newValue,
    };
  }

  private unmarshalAudit(item: Record<string, unknown>): AuditRecord {
    const auditId = item.auditId as string;
    const entity = item.entity as 'METADATA_TYPE' | 'METADATA_VALUE';
    const timestamp = item.timestamp as string;
    if (
      (entity === 'METADATA_VALUE' || entity === 'METADATA_TYPE') &&
      (Object.prototype.hasOwnProperty.call(item, 'oldValue') ||
        Object.prototype.hasOwnProperty.call(item, 'newValue'))
    ) {
      const act = (item.action as string) ?? (item.operation as string) ?? 'UNKNOWN';
      const by = (item.changedBy as string) ?? (item.actor as string);
      return {
        auditId,
        eventId: (item.eventId as string) ?? auditId,
        entity,
        action: act,
        operation: act,
        changedBy: by,
        actor: by,
        timestamp,
        oldValue: (item.oldValue as Record<string, unknown>) ?? {},
        newValue: (item.newValue as Record<string, unknown>) ?? {},
      };
    }
    return {
      auditId,
      entity,
      operation: (item.operation as string) ?? (item.action as string),
      action: item.action as string | undefined,
      actor: item.actor as string | undefined,
      changedBy: item.changedBy as string | undefined,
      timestamp,
      before: item.before,
      after: item.after,
    };
  }

  async getChangeRequestDraftPointer(
    metadataTypeCode: string,
    entityType: 'type' | 'value',
    metadataValueCode?: string,
  ): Promise<{ changeRequestId: string } | null> {
    const pointerPk = typePartitionKey(metadataTypeCode);
    const pointerSk = MetadataKeyBuilder.changeRequestDraftPointerSortKey(entityType, metadataValueCode);
    const item = await this.getItem(pointerPk, pointerSk);
    if (!item) {
      return null;
    }
    const id = item.changeRequestId;
    if (typeof id !== 'string' || id.trim() === '') {
      return null;
    }
    return { changeRequestId: id.trim() };
  }

  async saveChangeRequestDraft(record: ChangeRequestRecord): Promise<ChangeRequestRecord> {
    const pointerPk = typePartitionKey(record.metadataTypeCode);
    const pointerSk = MetadataKeyBuilder.changeRequestDraftPointerSortKey(
      record.entityType,
      record.metadataValueCode,
    );
    const existingPointer = await this.getChangeRequestDraftPointer(
      record.metadataTypeCode,
      record.entityType,
      record.metadataValueCode,
    );
    const previousDraftId = existingPointer?.changeRequestId ?? null;

    const draftPk = MetadataKeyBuilder.changeRequestPartitionKey(record.changeRequestId);
    const draftSk = MetadataKeyBuilder.changeRequestMetaSortKey();
    const draftItem = this.marshalChangeRequest(record, draftPk, draftSk);

    const pointerItem: Record<string, unknown> = {
      ...this.key(pointerPk, pointerSk),
      entityType: ENTITY_TYPE.CHANGE_REQUEST_DRAFT_POINTER,
      changeRequestId: record.changeRequestId,
      draftEntityType: record.entityType,
      metadataTypeCode: record.metadataTypeCode,
    };
    if (record.metadataValueCode) {
      pointerItem.metadataValueCode = record.metadataValueCode;
    }

    const transactItems: unknown[] = [];

    if (previousDraftId && previousDraftId !== record.changeRequestId) {
      const oldDraft = await this.getChangeRequestRecord(previousDraftId);
      if (oldDraft?.status === CHANGE_REQUEST_STATUS.DRAFT) {
        transactItems.push({
          Update: {
            TableName: this.tableName,
            Key: this.key(
              MetadataKeyBuilder.changeRequestPartitionKey(previousDraftId),
              MetadataKeyBuilder.changeRequestMetaSortKey(),
            ),
            UpdateExpression: 'SET #status = :cancelled, #modified = :now',
            ConditionExpression: '#status = :draft',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#modified': 'lastModifiedAt',
            },
            ExpressionAttributeValues: {
              ':cancelled': CHANGE_REQUEST_STATUS.CANCELLED,
              ':draft': CHANGE_REQUEST_STATUS.DRAFT,
              ':now': record.lastModifiedAt,
            },
          },
        });
      }
    }

    transactItems.push({ Put: { TableName: this.tableName, Item: draftItem } });
    transactItems.push({ Put: { TableName: this.tableName, Item: pointerItem } });
    await this.sendTx(transactItems);
    return record;
  }

  async getChangeRequest(changeRequestId: string): Promise<ChangeRequestRecord | null> {
    return this.getChangeRequestRecord(changeRequestId);
  }

  async markChangeRequestPublished(
    changeRequestId: string,
    params: { actor?: string; publishedAt: string },
  ): Promise<ChangeRequestRecord> {
    const existing = await this.getChangeRequestRecord(changeRequestId);
    if (!existing) {
      throw new NotFoundError(`Change request ${changeRequestId} not found`);
    }
    if (existing.status !== CHANGE_REQUEST_STATUS.DRAFT) {
      throw new ConflictError(
        `Change request ${changeRequestId} is not in DRAFT status`,
        'CHANGE_REQUEST_NOT_DRAFT',
      );
    }

    const record: ChangeRequestRecord = {
      ...existing,
      status: CHANGE_REQUEST_STATUS.PUBLISHED,
      lastModifiedAt: params.publishedAt,
      lastModifiedBy: params.actor ?? existing.lastModifiedBy,
    };

    const draftPk = MetadataKeyBuilder.changeRequestPartitionKey(changeRequestId);
    const draftSk = MetadataKeyBuilder.changeRequestMetaSortKey();
    const pointerPk = typePartitionKey(record.metadataTypeCode);
    const pointerSk = MetadataKeyBuilder.changeRequestDraftPointerSortKey(
      record.entityType,
      record.metadataValueCode,
    );

    await this.sendTx([
      {
        Put: {
          TableName: this.tableName,
          Item: this.marshalChangeRequest(record, draftPk, draftSk),
        },
      },
      {
        Delete: {
          TableName: this.tableName,
          Key: this.key(pointerPk, pointerSk),
        },
      },
    ]);

    return record;
  }

  private async getChangeRequestRecord(changeRequestId: string): Promise<ChangeRequestRecord | null> {
    const item = await this.getItem(
      MetadataKeyBuilder.changeRequestPartitionKey(changeRequestId),
      MetadataKeyBuilder.changeRequestMetaSortKey(),
    );
    if (!item) {
      return null;
    }
    return this.unmarshalChangeRequest(item);
  }

  private marshalChangeRequest(
    record: ChangeRequestRecord,
    pk: string,
    sk: string,
  ): Record<string, unknown> {
    return {
      ...this.key(pk, sk),
      entityType: ENTITY_TYPE.CHANGE_REQUEST,
      changeRequestId: record.changeRequestId,
      status: record.status,
      draftEntityType: record.entityType,
      operation: record.operation,
      metadataTypeCode: record.metadataTypeCode,
      ...(record.metadataValueCode ? { metadataValueCode: record.metadataValueCode } : {}),
      baseVersion: record.baseVersion,
      proposedPayload: record.proposedPayload,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      lastModifiedAt: record.lastModifiedAt,
      lastModifiedBy: record.lastModifiedBy,
    };
  }

  private unmarshalChangeRequest(item: Record<string, unknown>): ChangeRequestRecord {
    const entityType = item.draftEntityType === 'value' ? 'value' : 'type';
    const baseVersion = item.baseVersion;
    return {
      changeRequestId: String(item.changeRequestId),
      status: item.status as ChangeRequestRecord['status'],
      entityType,
      operation: item.operation as ChangeRequestRecord['operation'],
      metadataTypeCode: String(item.metadataTypeCode),
      metadataValueCode:
        item.metadataValueCode !== undefined && item.metadataValueCode !== null
          ? String(item.metadataValueCode)
          : undefined,
      baseVersion: baseVersion === null || baseVersion === undefined ? null : Number(baseVersion),
      proposedPayload: (item.proposedPayload as Record<string, unknown>) ?? {},
      createdAt: String(item.createdAt),
      createdBy: item.createdBy !== undefined ? String(item.createdBy) : undefined,
      lastModifiedAt: String(item.lastModifiedAt),
      lastModifiedBy: item.lastModifiedBy !== undefined ? String(item.lastModifiedBy) : undefined,
    };
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

