import {
  BatchGetCommand,
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { monotonicFactory } from 'ulid';

import {
  ENTITY_TYPE,
  LEGACY_CATALOG_PK,
  LEGACY_CATALOG_SK_PREFIX,
  metadataTypeUsesSeparateSchemaItem,
  resolveAttributeSchemaForMetadataType,
  STATUS,
} from '../domain/constants';
import type {
  Applicability,
  AuditRecord,
  MetadataTypeInput,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
  ValueSearchFilter,
} from '../domain/types';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import {
  auditTypePartitionKey,
  auditTypePrefix,
  auditValuePartitionKey,
  buildApplSortKeys,
  catalogPartitionKey,
  extractValueCodeFromApplSk,
  LEGACY_TYPE_ENTITY_SK_V1,
  schemaSk,
  typeEntitySk,
  typeLatestPointerSk,
  typePartitionKey,
  valueLatestSk,
  valueSk,
} from '../domain/keys';
import { getMetadataTypeDelta, typeCreateAuditNewValue } from '../domain/type-audit-delta';
import {
  getMetadataValueDelta,
  resolveValueUpdateAction,
  valueCreateAuditNewValue,
} from '../domain/value-audit-delta';
import { matchesSearchFilter, sortValuesForSearch } from '../domain/search-filter';
import type { IMetadataRegistryRepository, ListTypesFilter } from './metadata-registry.repository.interface';
import { assertEnumTokenArray, assertMetadataTypeCode, assertMetadataValueCode } from '../validators/code-patterns';
import {
  validateMetadataTypeInput,
  validateMetadataValueInput,
} from '../validators/validate-inputs';

const ulid = monotonicFactory();

const BATCH_GET_SIZE = 25;
const BATCH_WRITE_SIZE = 25;

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

  async createMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord> {
    validateMetadataTypeInput(input, false);
    assertMetadataTypeCode(input.metadataTypeCode);

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
    const record: MetadataTypeRecord = {
      metadataTypeCode: input.metadataTypeCode,
      version,
      displayName: input.displayName!,
      description: input.description,
      valueDataType: input.valueDataType as MetadataTypeRecord['valueDataType'],
      multiSelectAllowed: input.multiSelectAllowed!,
      applicableModules: input.applicableModules!,
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

    const transactItems = [
      { Put: { TableName: this.tableName, Item: typeItem } },
      { Put: { TableName: this.tableName, Item: auditItem } },
    ];
    if (schemaItem) {
      transactItems.splice(1, 0, { Put: { TableName: this.tableName, Item: schemaItem } });
    }

    await this.sendTx(transactItems);
    return record;
  }

  async updateMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord> {
    validateMetadataTypeInput(input, true);
    const existing = await this.getMetadataType(input.metadataTypeCode);
    if (!existing) {
      throw new NotFoundError(`Metadata type ${input.metadataTypeCode} not found`);
    }

    const pk = typePartitionKey(input.metadataTypeCode);
    const currentVersion = (await this.resolveLatestTypeVersion(pk)) ?? existing.version;

    const merged: MetadataTypeInput = {
      displayName: existing.displayName,
      description: existing.description,
      applicableModules: existing.applicableModules,
      valueApplicabilityConfig: existing.valueApplicabilityConfig,
      valueDataType: existing.valueDataType,
      multiSelectAllowed: existing.multiSelectAllowed,
      attributeSchema: existing.attributeSchema,
      status: existing.status,
      ...input,
      metadataTypeCode: input.metadataTypeCode,
    };

    const now = new Date().toISOString();

    /** Every update is a new immutable row `TYPE#METADATA#vN` / `SCHEMA#vN` — never overwrite an existing version. */
    const newVersion = currentVersion + 1;
    const record: MetadataTypeRecord = {
      ...existing,
      ...merged,
      version: newVersion,
      lastModifiedAt: now,
      lastModifiedBy: merged.lastModifiedBy ?? actor,
    };

    const typeItem = this.marshalType(record, pk, typeEntitySk(newVersion));
    const schemaItem = this.metadataSchemaPutItem(
      input.metadataTypeCode,
      pk,
      newVersion,
      resolveAttributeSchemaForMetadataType(input.metadataTypeCode, merged.attributeSchema),
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
    ]);

    return record;
  }

  async patchMetadataTypeStatus(metadataTypeCode: string, status: Status, actor?: string): Promise<MetadataTypeRecord> {
    assertMetadataTypeCode(metadataTypeCode);
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
    ]);

    return record;
  }

  async getMetadataType(metadataTypeCode: string): Promise<MetadataTypeRecord | null> {
    assertMetadataTypeCode(metadataTypeCode);
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

  async listMetadataTypes(filter: ListTypesFilter): Promise<MetadataTypeRecord[]> {
    const indexRows = await this.queryAll(catalogPartitionKey(), 'TYPE#');
    const legacyRows = await this.queryAll(LEGACY_CATALOG_PK, LEGACY_CATALOG_SK_PREFIX);
    const fromIndexAndLegacy = [...indexRows, ...legacyRows]
      .filter((r) => r.entityType === ENTITY_TYPE.CATALOG_ENTRY)
      .map((r) => r.metadataTypeCode as string)
      .filter(Boolean);
    const fromPartitions = await this.discoverMetadataTypeCodesOnPartitions();
    const uniqueCodes = [...new Set([...fromIndexAndLegacy, ...fromPartitions])];

    const results: MetadataTypeRecord[] = [];
    for (const code of uniqueCodes) {
      const t = await this.getMetadataType(code);
      if (!t) {
        continue;
      }
      if (filter.status && t.status !== filter.status) {
        continue;
      }
      if (filter.module && !t.applicableModules?.includes(filter.module)) {
        continue;
      }
      if (filter.valueDataType && t.valueDataType !== filter.valueDataType) {
        continue;
      }
      results.push(t);
    }
    return results.sort((a, b) => a.metadataTypeCode.localeCompare(b.metadataTypeCode));
  }

  async createMetadataValue(metadataTypeCode: string, input: MetadataValueInput, actor?: string): Promise<MetadataValueRecord> {
    const type = await this.getMetadataType(metadataTypeCode);
    if (!type) {
      throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
    }
    validateMetadataValueInput(input, {
      metadataType: type,
      mode: 'create',
      mergedIsGlobal: input.isGlobal!,
    });

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

    await this.sendTx([
      { Put: { TableName: this.tableName, Item: valueItem } },
      { Put: { TableName: this.tableName, Item: latestPointer } },
      { Put: { TableName: this.tableName, Item: auditItem } },
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
    const type = await this.getMetadataType(metadataTypeCode);
    if (!type) {
      throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
    }

    const mergedIsGlobal = input.isGlobal ?? existing.isGlobal;
    validateMetadataValueInput(input, {
      metadataType: type,
      mode: 'update',
      mergedIsGlobal,
      expectedValueCode: existing.valueCode,
    });

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
    ]);

    await this.syncApplRows(pk, existing.applSkKeys, record.applSkKeys, metadataTypeCode, input.valueCode);
    return record;
  }

  async patchMetadataValueStatus(metadataTypeCode: string, valueCode: string, status: Status, actor?: string): Promise<MetadataValueRecord> {
    assertMetadataValueCode(valueCode);
    const existing = await this.getMetadataValue(metadataTypeCode, valueCode);
    if (!existing) {
      throw new NotFoundError(`Value ${valueCode} not found`);
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
    ]);

    return record;
  }

  async getMetadataValue(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord | null> {
    assertMetadataValueCode(valueCode);
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

  async listMetadataValues(metadataTypeCode: string, statusFilter?: Status): Promise<MetadataValueRecord[]> {
    assertMetadataTypeCode(metadataTypeCode);
    const pk = typePartitionKey(metadataTypeCode);
    const rows = await this.queryAll(pk, 'VALUE_LATEST#');
    const codes = rows
      .filter((r) => r.entityType === 'VALUE_LATEST')
      .map((r) => r.valueCode as string)
      .filter(Boolean);

    const values = await this.batchLoadValues(pk, codes);
    const defaultStatus = STATUS.ACTIVE;
    const effective = statusFilter ?? defaultStatus;
    return values.filter((v) => v.status === effective);
  }

  async searchMetadataValues(metadataTypeCode: string, filter: ValueSearchFilter): Promise<MetadataValueRecord[]> {
    assertMetadataTypeCode(metadataTypeCode);
    this.validateSearchFilter(filter);

    const pk = typePartitionKey(metadataTypeCode);
    const applRows = await this.queryAll(pk, 'APPL#');
    const fromAppl = new Set<string>();
    for (const r of applRows) {
      const sk = r[this.skAttr] as string;
      const code = extractValueCodeFromApplSk(sk);
      if (code) {
        fromAppl.add(code);
      }
    }

    const latestRows = await this.queryAll(pk, 'VALUE_LATEST#');
    const allCodes = new Set<string>();
    for (const r of latestRows) {
      if (r.entityType === 'VALUE_LATEST' && r.valueCode) {
        allCodes.add(r.valueCode as string);
      }
    }
    fromAppl.forEach((c) => allCodes.add(c));

    const values = await this.batchLoadValues(pk, [...allCodes]);
    const defaultStatus = STATUS.ACTIVE;
    const matched = values.filter((v) => matchesSearchFilter(v, filter, defaultStatus));
    return sortValuesForSearch(matched);
  }

  async listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]> {
    assertMetadataTypeCode(metadataTypeCode);
    const rows = await this.queryAll(auditTypePartitionKey(metadataTypeCode), 'TIMESTAMP#');
    const legacyPk = typePartitionKey(metadataTypeCode);
    const legacyPrefix = `${auditTypePrefix(metadataTypeCode)}#`;
    const legacyRows = await this.queryAll(legacyPk, legacyPrefix);
    const merged = [...rows, ...legacyRows];
    return merged
      .filter((r) => r.entityType === 'AUDIT')
      .map((r) => this.unmarshalAudit(r))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]> {
    assertMetadataValueCode(valueCode);
    const rows = await this.queryAll(auditValuePartitionKey(valueCode), 'TIMESTAMP#');
    const legacyPk = typePartitionKey(metadataTypeCode);
    const legacyPrefix = `${auditValuePartitionKey(valueCode)}#`;
    const legacyRows = await this.queryAll(legacyPk, legacyPrefix);
    const merged = [...rows, ...legacyRows];
    return merged
      .filter((r) => r.entityType === 'AUDIT')
      .map((r) => this.unmarshalAudit(r))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // --- helpers ---

  private validateSearchFilter(filter: ValueSearchFilter): void {
    if (filter.status && filter.status !== STATUS.ACTIVE && filter.status !== STATUS.INACTIVE) {
      throw new ValidationError('Invalid status filter', [{ field: 'status', message: 'Must be ACTIVE or INACTIVE' }]);
    }
    assertEnumTokenArray(filter.module, 'module');
    assertEnumTokenArray(filter.category, 'category');
    assertEnumTokenArray(filter.condition, 'condition');
    assertEnumTokenArray(filter.country, 'country');
    assertEnumTokenArray(filter.language, 'language');
  }

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
    const rows = await this.queryAll(pk, 'TYPE#METADATA');
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

  /**
   * Collects `metadataTypeCode` values from `METADATA_TYPE#<code>` partitions by scanning for type-entity
   * rows only (`TYPE#METADATA#v*` and legacy `TYPE#METADATA`). Used for listing when catalog
   * items under `METADATA_TYPES` / `TYPE#<code>` are not written.
   */
  private async discoverMetadataTypeCodesOnPartitions(): Promise<string[]> {
    const pkPrefix = typePartitionKey('');
    const typeEntitySkPrefix = 'TYPE#METADATA#';
    const codes = new Set<string>();
    let startKey: Record<string, unknown> | undefined;
    do {
      try {
        const res = (await this.doc.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: 'begins_with(#pk, :p) AND (begins_with(#sk, :t) OR #sk = :leg)',
            ExpressionAttributeNames: { '#pk': this.pkAttr, '#sk': this.skAttr },
            ExpressionAttributeValues: {
              ':p': pkPrefix,
              ':t': typeEntitySkPrefix,
              ':leg': LEGACY_TYPE_ENTITY_SK_V1,
            },
            ProjectionExpression: '#pk',
            ExclusiveStartKey: startKey,
          }),
        )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
        for (const it of res.Items ?? []) {
          const pk = it[this.pkAttr] as string;
          if (typeof pk === 'string' && pk.startsWith(pkPrefix) && pk.length > pkPrefix.length) {
            codes.add(pk.slice(pkPrefix.length));
          }
        }
        startKey = res.LastEvaluatedKey;
      } catch (e: unknown) {
        this.rethrowDynamo('Scan', e);
      }
    } while (startKey);
    return [...codes];
  }

  private async batchLoadValues(pk: string, valueCodes: string[]): Promise<MetadataValueRecord[]> {
    if (valueCodes.length === 0) {
      return [];
    }
    const latestMap = new Map<string, number>();
    const chunks = chunk(valueCodes, BATCH_GET_SIZE);
    for (const part of chunks) {
      const keys = part.map((code) => this.key(pk, valueLatestSk(code)));
      const res = (await this.doc.send(
        new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: keys } } }),
      )) as { Responses?: Record<string, Record<string, unknown>[]> };
      const items = res.Responses?.[this.tableName] ?? [];
      for (const it of items) {
        const code = it.valueCode as string;
        latestMap.set(code, it.latestVersion as number);
      }
    }

    const valueKeys: { pk: string; sk: string }[] = [];
    for (const [code, ver] of latestMap) {
      valueKeys.push({ pk, sk: valueSk(code, ver) });
    }

    const values: MetadataValueRecord[] = [];
    for (const part of chunk(valueKeys, BATCH_GET_SIZE)) {
      const res = (await this.doc.send(
        new BatchGetCommand({
          RequestItems: { [this.tableName]: { Keys: part.map((k) => this.key(k.pk, k.sk)) } },
        }),
      )) as { Responses?: Record<string, Record<string, unknown>[]> };
      const items = res.Responses?.[this.tableName] ?? [];
      for (const it of items) {
        values.push(this.unmarshalValue(it as Record<string, unknown>));
      }
    }
    return values;
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
      await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } }));
    }
  }

  private async deleteApplRows(pk: string, keys: string[]): Promise<void> {
    for (const part of chunk(keys, BATCH_WRITE_SIZE)) {
      const requests = part.map((sk) => ({
        DeleteRequest: { Key: this.key(pk, sk) },
      }));
      await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } }));
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

    return {
      metadataTypeCode: typeItem.metadataTypeCode as string,
      version: typeItem.version as number,
      displayName,
      description: typeItem.description as string | undefined,
      valueDataType,
      multiSelectAllowed,
      applicableModules,
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
    const sk = `TIMESTAMP#${params.timestamp}#${id}`;
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
      action: 'CREATE' | 'UPDATE' | 'UPDATE_BREAKING' | 'UPDATE' | 'STATUS';
      changedBy?: string;
      timestamp: string;
      oldValue: Record<string, unknown>;
      newValue: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const id = ulid();
    const sk = `TIMESTAMP#${params.timestamp}#${id}`;
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
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

