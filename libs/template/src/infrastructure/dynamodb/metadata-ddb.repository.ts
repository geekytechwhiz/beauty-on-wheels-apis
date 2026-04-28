import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { MetadataListStatusFilter, MetadataRepository } from '../../application/metadata-repository.port';
import type {
  MetadataApplicabilityContext,
  MetadataDefinition,
} from '../../domain/metadata-definition.types';
import { isMetadataApplicable } from '../../domain/metadata-applicability';
import { TtlJsonCache } from '../s3/json-cache';
import {
  METADATA_ENTITY_TYPE,
  METADATA_REGISTRY_TYPES,
  metadataPk,
  metadataSk,
} from './keys';

const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const METADATA_CACHE_MAX_ENTRIES = 256;

type MetadataDdbItem = Record<string, unknown> & {
  pk: string;
  sk: string;
  entityType: typeof METADATA_ENTITY_TYPE;
};

function stripKeys(item: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...item };
  delete rest.pk;
  delete rest.sk;
  delete rest.gsi1pk;
  delete rest.gsi1sk;
  delete rest.gsi3pk;
  delete rest.gsi3sk;
  delete rest.gsi2pk;
  delete rest.gsi2sk;
  delete rest.entityType;
  return rest;
}

function fromItem(item: Record<string, unknown>): MetadataDefinition {
  const rest = stripKeys(item);
  const applicability = rest.applicability;
  if (!applicability || typeof applicability !== 'object' || Array.isArray(applicability)) {
    throw new Error('METADATA item missing applicability map');
  }
  const app = applicability as Record<string, unknown>;
  return {
    name: String(rest.name ?? ''),
    type: rest.type as MetadataDefinition['type'],
    values: Array.isArray(rest.values) ? (rest.values as string[]) : undefined,
    defaultValue: rest.defaultValue,
    metadataMode: rest.metadataMode as MetadataDefinition['metadataMode'],
    applicability: {
      templateType: Array.isArray(app.templateType) ? (app.templateType as string[]) : [],
      category: Array.isArray(app.category) ? (app.category as string[]) : [],
      condition: Array.isArray(app.condition) ? (app.condition as string[]) : [],
      country: Array.isArray(app.country) ? (app.country as string[]) : [],
    },
    constraints:
      rest.constraints && typeof rest.constraints === 'object' && !Array.isArray(rest.constraints)
        ? (rest.constraints as MetadataDefinition['constraints'])
        : undefined,
    status: (rest.status as MetadataDefinition['status']) ?? 'INACTIVE',
    version: String(rest.version ?? ''),
    createdAt: String(rest.createdAt ?? ''),
    updatedAt: String(rest.updatedAt ?? ''),
  };
}

function compareVersionDesc(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

function toItem(metadataType: string, def: MetadataDefinition): MetadataDdbItem {
  return {
    pk: metadataPk(metadataType),
    sk: metadataSk(def.name, def.version),
    entityType: METADATA_ENTITY_TYPE,
    name: def.name,
    type: def.type,
    ...(def.values !== undefined ? { values: def.values } : {}),
    ...(def.defaultValue !== undefined ? { defaultValue: def.defaultValue } : {}),
    metadataMode: def.metadataMode,
    applicability: def.applicability,
    ...(def.constraints !== undefined ? { constraints: def.constraints } : {}),
    status: def.status,
    version: def.version,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
  };
}

export class MetadataDdbRepository implements MetadataRepository {
  private readonly listByTypeCache = new TtlJsonCache<MetadataDefinition[]>(
    METADATA_CACHE_TTL_MS,
    METADATA_CACHE_MAX_ENTRIES,
  );
  private readonly getExactCache = new TtlJsonCache<MetadataDefinition | null>(
    METADATA_CACHE_TTL_MS,
    METADATA_CACHE_MAX_ENTRIES,
  );

  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    if (!tableName) {
      throw new Error('TEMPLATE_TABLE is not configured');
    }
  }

  private invalidateCaches(): void {
    this.listByTypeCache.clear();
    this.getExactCache.clear();
  }

  async getMetadataExact(
    metadataType: string,
    name: string,
    version: string,
  ): Promise<MetadataDefinition | null> {
    const pk = metadataPk(metadataType);
    const sk = metadataSk(name, version);
    const hit = (await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }) as never,
    )) as { Item?: Record<string, unknown> };
    const item = hit.Item as MetadataDdbItem | undefined;
    if (!item || item.entityType !== METADATA_ENTITY_TYPE) {
      return null;
    }
    return fromItem(item);
  }

  async getMetadata(
    metadataType: string,
    name: string,
    version?: string,
  ): Promise<MetadataDefinition | null> {
    const cacheKey = `get:${metadataType}:${name}:${version ?? 'latest'}`;
    const cached = this.getExactCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const pk = metadataPk(metadataType);

    if (version) {
      const def = await this.getMetadataExact(metadataType, name, version);
      this.getExactCache.set(cacheKey, def);
      return def;
    }

    const prefix = `METADATA#${name}#`;
    const result = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': prefix,
        },
      }) as never,
    )) as { Items?: Record<string, unknown>[] };

    const items = (result.Items ?? []).filter(
      (it: Record<string, unknown>) => (it as MetadataDdbItem).entityType === METADATA_ENTITY_TYPE,
    ) as MetadataDdbItem[];
    if (items.length === 0) {
      this.getExactCache.set(cacheKey, null);
      return null;
    }
    const defs = items.map((it) => fromItem(it));
    const active = defs.filter((d) => d.status === 'ACTIVE');
    const pool = active.length > 0 ? active : defs;
    pool.sort((a, b) => compareVersionDesc(a.version, b.version));
    const picked = pool[0] ?? null;
    this.getExactCache.set(cacheKey, picked);
    return picked;
  }

  async getAllByType(metadataType: string): Promise<MetadataDefinition[]> {
    const cacheKey = `all:${metadataType}`;
    const cached = this.listByTypeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': metadataPk(metadataType),
        },
      }) as never,
    )) as { Items?: Record<string, unknown>[] };

    const items = (result.Items ?? []).filter(
      (it: Record<string, unknown>) => (it as MetadataDdbItem).entityType === METADATA_ENTITY_TYPE,
    ) as MetadataDdbItem[];

    const defs = items.map((it) => fromItem(it)).filter((d) => d.status === 'ACTIVE');
    this.listByTypeCache.set(cacheKey, defs);
    return defs;
  }

  async getApplicableMetadata(context: MetadataApplicabilityContext): Promise<MetadataDefinition[]> {
    const lists = await Promise.all(
      METADATA_REGISTRY_TYPES.map((t) => this.getAllByType(t)),
    );
    const merged = lists.flat();
    return merged.filter((m) => m.status === 'ACTIVE' && isMetadataApplicable(m, context));
  }

  async listMetadataByType(
    metadataType: string,
    filter: MetadataListStatusFilter,
  ): Promise<MetadataDefinition[]> {
    const result = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': metadataPk(metadataType),
        },
      }) as never,
    )) as { Items?: Record<string, unknown>[] };

    const items = (result.Items ?? []).filter(
      (it: Record<string, unknown>) => (it as MetadataDdbItem).entityType === METADATA_ENTITY_TYPE,
    ) as MetadataDdbItem[];

    const defs = items.map((it) => fromItem(it));
    if (filter === 'all') {
      return defs.sort((a, b) => a.name.localeCompare(b.name) || compareVersionDesc(a.version, b.version));
    }
    if (filter === 'active') {
      return defs
        .filter((d) => d.status === 'ACTIVE')
        .sort((a, b) => a.name.localeCompare(b.name) || compareVersionDesc(a.version, b.version));
    }
    return defs
      .filter((d) => d.status === 'INACTIVE')
      .sort((a, b) => a.name.localeCompare(b.name) || compareVersionDesc(a.version, b.version));
  }

  async listVersionsForName(metadataType: string, name: string): Promise<MetadataDefinition[]> {
    const pk = metadataPk(metadataType);
    const prefix = `METADATA#${name}#`;
    const result = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': prefix,
        },
      }) as never,
    )) as { Items?: Record<string, unknown>[] };

    const items = (result.Items ?? []).filter(
      (it: Record<string, unknown>) => (it as MetadataDdbItem).entityType === METADATA_ENTITY_TYPE,
    ) as MetadataDdbItem[];

    const defs = items.map((it) => fromItem(it));
    return defs.sort((a, b) => compareVersionDesc(a.version, b.version));
  }

  async upsertMetadata(metadataType: string, definition: MetadataDefinition): Promise<void> {
    const item = toItem(metadataType, definition);
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }) as never,
    );
    this.invalidateCaches();
  }

  async deleteMetadata(metadataType: string, name: string, version: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: metadataPk(metadataType),
          sk: metadataSk(name, version),
        },
      }) as never,
    );
    this.invalidateCaches();
  }
}
