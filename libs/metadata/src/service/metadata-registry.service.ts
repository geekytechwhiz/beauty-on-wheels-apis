import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { TtlJsonCache } from '@api-hub/template';
import {
  applicabilityLookupCandidates,
  expandApplicabilityTuples,
  valueAppliesToContext,
} from '../domain/applicability';
import type { MetadataRegistryEvent } from '../domain/events';
import {
  MetadataConflictError,
  MetadataNotFoundError,
  MetadataValidationError,
} from '../domain/errors';
import type { ApplicabilityContext, MetadataType, MetadataValue } from '../domain/types';
import { MetadataRegistryRepository, type PaginatedResult } from '../repository/metadata-registry.repository';
import { assertValueAttributesMatchSchema } from '../validators/value-attributes.validator';
import type {
  CreateMetadataTypeInput,
  CreateMetadataValueInput,
  UpdateMetadataTypeInput,
  UpdateMetadataValueInput,
} from '../validators/schemas';
import { MetadataRegistryEventBridgePublisher } from '../infrastructure/eventbridge.publisher';

const baseLogger = createLogger({ service: 'metadata-registry-service' });

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 256;

function nowIso(): string {
  return new Date().toISOString();
}

function schemasEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export class MetadataRegistryService {
  private readonly repo: MetadataRegistryRepository;
  private readonly publisher: MetadataRegistryEventBridgePublisher | null;
  private readonly typeCache = new TtlJsonCache<MetadataType | null>(CACHE_TTL_MS, CACHE_MAX);
  private readonly typeListCache = new TtlJsonCache<MetadataType[]>(CACHE_TTL_MS, CACHE_MAX);
  private readonly valueCache = new TtlJsonCache<MetadataValue | null>(CACHE_TTL_MS, CACHE_MAX);

  constructor(docClient: DynamoDBDocumentClient, tableName: string, eventBusName?: string) {
    this.repo = new MetadataRegistryRepository(docClient, tableName);
    this.publisher =
      eventBusName && eventBusName.length > 0
        ? new MetadataRegistryEventBridgePublisher(new EventBridgeClient({}), eventBusName)
        : null;
  }

  private invalidateCaches(): void {
    this.typeCache.clear();
    this.typeListCache.clear();
    this.valueCache.clear();
  }

  private async emit(event: MetadataRegistryEvent): Promise<void> {
    if (!this.publisher) return;
    const logger = createChildLogger(baseLogger, { event: 'emit', type: event.type });
    try {
      await this.publisher.publish(event);
    } catch (err) {
      logger.error({ event: 'emit_failed', err: serializeError(err) });
      throw err;
    }
  }

  async createMetadataType(input: CreateMetadataTypeInput): Promise<MetadataType> {
    const ts = nowIso();
    const type: MetadataType = {
      metadataTypeCode: input.metadataTypeCode,
      displayName: input.displayName,
      description: input.description,
      valueDataType: input.valueDataType,
      multiSelectAllowed: input.multiSelectAllowed,
      applicableModules: input.applicableModules,
      attributeSchema: input.attributeSchema,
      status: input.status,
      version: 1,
      createdAt: ts,
      lastModifiedAt: ts,
      createdBy: input.createdBy,
    };

    try {
      await this.repo.putMetadataType(type);
    } catch (err) {
      if (isConditionalFailure(err)) {
        throw new MetadataConflictError(`Metadata type already exists: ${input.metadataTypeCode}`);
      }
      throw err;
    }

    this.invalidateCaches();
    await this.emit({
      type: 'METADATA_TYPE_CREATED',
      timestamp: ts,
      metadataType: type,
    });
    return type;
  }

  async updateMetadataType(
    metadataTypeCode: string,
    input: UpdateMetadataTypeInput,
  ): Promise<MetadataType> {
    const existing = await this.repo.getMetadataType(metadataTypeCode);
    if (!existing) {
      throw new MetadataNotFoundError('MetadataType', metadataTypeCode);
    }

    const schemaChanged =
      input.attributeSchema !== undefined &&
      !schemasEqual(existing.attributeSchema, input.attributeSchema);

    const nextVersion =
      schemaChanged && existing.version !== undefined ? existing.version + 1 : existing.version;

    const ts = nowIso();
    const patch: Partial<MetadataType> = {
      ...input,
      version: nextVersion,
      lastModifiedAt: ts,
    };

    const updated = await this.repo.updateMetadataType(metadataTypeCode, patch);
    this.invalidateCaches();

    if (schemaChanged) {
      await this.emit({
        type: 'METADATA_SCHEMA_UPDATED',
        timestamp: ts,
        metadataType: updated,
      });
    } else {
      await this.emit({
        type: 'METADATA_TYPE_UPDATED',
        timestamp: ts,
        metadataType: updated,
      });
    }
    return updated;
  }

  async inactivateMetadataType(metadataTypeCode: string, lastModifiedBy?: string): Promise<MetadataType> {
    const existing = await this.repo.getMetadataType(metadataTypeCode);
    if (!existing) {
      throw new MetadataNotFoundError('MetadataType', metadataTypeCode);
    }
    const ts = nowIso();
    const updated = await this.repo.updateMetadataType(metadataTypeCode, {
      status: 'INACTIVE',
      version: existing.version + 1,
      lastModifiedAt: ts,
      lastModifiedBy,
    });
    this.invalidateCaches();
    await this.emit({
      type: 'METADATA_TYPE_UPDATED',
      timestamp: ts,
      metadataType: updated,
    });
    return updated;
  }

  async getMetadataType(metadataTypeCode: string): Promise<MetadataType> {
    const key = `type:${metadataTypeCode}`;
    const hit = this.typeCache.get(key);
    if (hit !== undefined) {
      return hit as MetadataType;
    }
    const t = await this.repo.getMetadataType(metadataTypeCode);
    if (!t) {
      throw new MetadataNotFoundError('MetadataType', metadataTypeCode);
    }
    this.typeCache.set(key, t);
    return t;
  }

  async listMetadataTypes(options?: { includeInactive?: boolean }): Promise<MetadataType[]> {
    const key = `all:${options?.includeInactive ?? false}`;
    const hit = this.typeListCache.get(key);
    if (hit) {
      return hit;
    }
    const list = await this.repo.listMetadataTypes();
    const filtered = options?.includeInactive
      ? list
      : list.filter((t) => t.status === 'ACTIVE');
    filtered.sort((a, b) => a.metadataTypeCode.localeCompare(b.metadataTypeCode));
    this.typeListCache.set(key, filtered);
    return filtered;
  }

  async listMetadataTypesPaginated(options?: {
    limit?: number;
    nextToken?: string;
    includeInactive?: boolean;
  }): Promise<PaginatedResult<MetadataType>> {
    const result = await this.repo.listMetadataTypesPaginated(
      options?.limit,
      options?.nextToken,
    );
    if (!options?.includeInactive) {
      result.items = result.items.filter((t) => t.status === 'ACTIVE');
    }
    return result;
  }

  async createMetadataValue(
    metadataTypeCode: string,
    input: CreateMetadataValueInput,
  ): Promise<MetadataValue> {
    const type = await this.repo.getMetadataType(metadataTypeCode);
    if (!type || type.status !== 'ACTIVE') {
      throw new MetadataNotFoundError('MetadataType', metadataTypeCode);
    }

    assertValueAttributesMatchSchema(input.valueAttributes, type.attributeSchema);

    const ts = nowIso();
    const value: MetadataValue = {
      metadataTypeCode,
      metadataValueCode: input.metadataValueCode,
      label: input.label,
      description: input.description,
      status: 'ACTIVE',
      isGlobal: input.isGlobal,
      applicableModules: input.applicableModules,
      applicableCategories: input.applicableCategories,
      applicableConditions: input.applicableConditions,
      applicableCountries: input.applicableCountries,
      valueAttributes: input.valueAttributes,
      version: 1,
      createdAt: ts,
      lastModifiedAt: ts,
      createdBy: input.createdBy,
    };

    const tuples = expandApplicabilityTuples({
      isGlobal: value.isGlobal,
      applicableModules: value.applicableModules,
      applicableCategories: value.applicableCategories,
      applicableConditions: value.applicableConditions,
      applicableCountries: value.applicableCountries,
    });

    try {
      await this.repo.putMetadataValue(value);
      await this.repo.writeApplRows(metadataTypeCode, input.metadataValueCode, tuples);
    } catch (err) {
      if (isConditionalFailure(err)) {
        throw new MetadataConflictError(
          `Metadata value already exists: ${metadataTypeCode}/${input.metadataValueCode}`,
        );
      }
      throw err;
    }

    this.invalidateCaches();
    await this.emit({
      type: 'METADATA_VALUE_CREATED',
      timestamp: ts,
      metadataTypeCode,
      metadataValue: value,
    });
    await this.emit({
      type: 'METADATA_RELATION_UPDATED',
      timestamp: ts,
      metadataTypeCode,
      metadataValue: value,
    });
    return value;
  }

  async updateMetadataValue(
    metadataTypeCode: string,
    metadataValueCode: string,
    input: UpdateMetadataValueInput,
  ): Promise<MetadataValue> {
    const type = await this.repo.getMetadataType(metadataTypeCode);
    if (!type) {
      throw new MetadataNotFoundError('MetadataType', metadataTypeCode);
    }
    const existing = await this.repo.getMetadataValue(metadataTypeCode, metadataValueCode);
    if (!existing) {
      throw new MetadataNotFoundError('MetadataValue', `${metadataTypeCode}/${metadataValueCode}`);
    }

    const nextAttrs = input.valueAttributes ?? existing.valueAttributes;
    assertValueAttributesMatchSchema(nextAttrs, type.attributeSchema);

    const merged: MetadataValue = {
      ...existing,
      ...input,
      metadataTypeCode,
      metadataValueCode,
      valueAttributes: nextAttrs,
      applicableModules: input.applicableModules ?? existing.applicableModules,
      applicableCategories: input.applicableCategories ?? existing.applicableCategories,
      applicableConditions: input.applicableConditions ?? existing.applicableConditions,
      applicableCountries: input.applicableCountries ?? existing.applicableCountries,
      isGlobal: input.isGlobal ?? existing.isGlobal,
    };

    const tuples = expandApplicabilityTuples({
      isGlobal: merged.isGlobal,
      applicableModules: merged.applicableModules,
      applicableCategories: merged.applicableCategories,
      applicableConditions: merged.applicableConditions,
      applicableCountries: merged.applicableCountries,
    });

    const relationChanged = JSON.stringify(tuples) !==
      JSON.stringify(
        expandApplicabilityTuples({
          isGlobal: existing.isGlobal,
          applicableModules: existing.applicableModules,
          applicableCategories: existing.applicableCategories,
          applicableConditions: existing.applicableConditions,
          applicableCountries: existing.applicableCountries,
        }),
      );

    const valueAttrsChanged =
      input.valueAttributes !== undefined &&
      JSON.stringify(input.valueAttributes) !== JSON.stringify(existing.valueAttributes);

    const version =
      relationChanged || valueAttrsChanged ? existing.version + 1 : existing.version;

    const ts = nowIso();
    const patch: Partial<MetadataValue> = {
      ...input,
      valueAttributes: nextAttrs,
      lastModifiedAt: ts,
      version,
    };

    const updated = await this.repo.updateMetadataValue(metadataTypeCode, metadataValueCode, patch);
    await this.repo.replaceApplRows(metadataTypeCode, metadataValueCode, tuples);

    this.invalidateCaches();
    await this.emit({
      type: 'METADATA_VALUE_UPDATED',
      timestamp: ts,
      metadataTypeCode,
      metadataValue: updated,
    });
    if (relationChanged) {
      await this.emit({
        type: 'METADATA_RELATION_UPDATED',
        timestamp: ts,
        metadataTypeCode,
        metadataValue: updated,
      });
    }
    return updated;
  }

  async inactivateMetadataValue(
    metadataTypeCode: string,
    metadataValueCode: string,
    lastModifiedBy?: string,
  ): Promise<MetadataValue> {
    const existing = await this.repo.getMetadataValue(metadataTypeCode, metadataValueCode);
    if (!existing) {
      throw new MetadataNotFoundError('MetadataValue', `${metadataTypeCode}/${metadataValueCode}`);
    }
    const ts = nowIso();
    const updated = await this.repo.updateMetadataValue(metadataTypeCode, metadataValueCode, {
      status: 'INACTIVE',
      version: existing.version + 1,
      lastModifiedAt: ts,
      lastModifiedBy,
    });
    this.invalidateCaches();
    await this.emit({
      type: 'METADATA_VALUE_INACTIVATED',
      timestamp: ts,
      metadataTypeCode,
      metadataValue: updated,
      metadataValueCode,
    });
    return updated;
  }

  async getMetadataValue(
    metadataTypeCode: string,
    metadataValueCode: string,
  ): Promise<MetadataValue> {
    const key = `val:${metadataTypeCode}:${metadataValueCode}`;
    const hit = this.valueCache.get(key);
    if (hit !== undefined) {
      return hit as MetadataValue;
    }
    const v = await this.repo.getMetadataValue(metadataTypeCode, metadataValueCode);
    if (!v) {
      throw new MetadataNotFoundError('MetadataValue', `${metadataTypeCode}/${metadataValueCode}`);
    }
    this.valueCache.set(key, v);
    return v;
  }

  async listMetadataValuesByContext(
    metadataTypeCode: string,
    ctx: ApplicabilityContext,
    options?: { includeInactive?: boolean },
  ): Promise<MetadataValue[]> {
    const all = await this.repo.listMetadataValues(metadataTypeCode);
    return all.filter((v) => {
      if (!options?.includeInactive && v.status !== 'ACTIVE') return false;
      return valueAppliesToContext(v, ctx);
    });
  }

  async listMetadataValuesPaginated(
    metadataTypeCode: string,
    options?: {
      limit?: number;
      nextToken?: string;
      includeInactive?: boolean;
    },
  ): Promise<PaginatedResult<MetadataValue>> {
    const statusFilter = options?.includeInactive ? undefined : 'ACTIVE' as const;
    return this.repo.listMetadataValuesPaginated(
      metadataTypeCode,
      options?.limit,
      options?.nextToken,
      statusFilter,
    );
  }

  async validateMetadataValue(
    metadataTypeCode: string,
    metadataValueCode: string,
    ctx: ApplicabilityContext,
  ): Promise<{ valid: boolean; reason?: string }> {
    const type = await this.repo.getMetadataType(metadataTypeCode);
    if (!type || type.status !== 'ACTIVE') {
      return { valid: false, reason: 'METADATA_TYPE_NOT_ACTIVE' };
    }

    const value = await this.repo.getMetadataValue(metadataTypeCode, metadataValueCode);
    if (!value || value.status !== 'ACTIVE') {
      return { valid: false, reason: 'METADATA_VALUE_NOT_ACTIVE' };
    }

    try {
      assertValueAttributesMatchSchema(value.valueAttributes, type.attributeSchema);
    } catch (e) {
      if (e instanceof MetadataValidationError) {
        return { valid: false, reason: 'VALUE_ATTRIBUTES_INVALID' };
      }
      throw e;
    }

    for (const cand of applicabilityLookupCandidates(ctx)) {
      const appl = await this.repo.getApplItem(
        metadataTypeCode,
        cand.module,
        cand.category,
        cand.condition,
        cand.country,
        metadataValueCode,
      );
      if (appl) {
        return { valid: true };
      }
    }

    return { valid: false, reason: 'APPLICABILITY_MISMATCH' };
  }
}

function isConditionalFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}
