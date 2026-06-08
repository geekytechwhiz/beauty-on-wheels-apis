import { monotonicFactory } from 'ulid';

import { STATUS } from '../constants';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  assertMetadataTypeActiveForValueMutation,
  assertPostUpsertAllowedForLatestStatus,
} from '../domain/errors';
import type { MetadataTypeInput, MetadataValueInput } from '../models/types';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  type ChangeRequestDraftResponse,
  type ChangeRequestRecord,
  toChangeRequestDraftResponse,
} from '../models/change-request.types';
import {
  mergeMetadataTypeForUpdate,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
} from '../mappers/metadata-request.mapper';
import { isAttributeSchemaCompatibleExtension } from '../domain/diff';
import { attributeSchemaFieldMapForCompatibility } from '../validators/attribute-schema.validator';
import {
  validateMetadataTypeInput,
  validateMetadataValueInput,
} from '../validators/validate-inputs';
import { assertMetadataTypeCode, assertMetadataValueCode } from '../validators/code-patterns';
import type { RelationType } from '../models/relation-types';
import { assertGovernedRelationTypeForTypes } from '../validators/relation';
import { getMetadataRepository } from '../dynamodb/dynamodb.client';
import {
  assertRelationshipTargetsReferenceValidValues,
  validateValueRelationshipsPayload,
} from './metadata-value-relation.service';
import { QUESTION_TYPE_METADATA_CODE } from '../constants';
import type { RegistryPostMetadataInput } from './metadata.service.types';

const ulid = monotonicFactory();

function actorFromContext(userId?: string): string | undefined {
  return userId;
}

async function assertMetadataTypeRelationTargetExists(input: MetadataTypeInput): Promise<void> {
  if (!input.supportsRelations || !input.targetMetadataTypeCode?.trim()) {
    return;
  }
  const code = input.targetMetadataTypeCode.trim();
  const repo = await getMetadataRepository();
  const t = await repo.getMetadataType(code);
  if (!t) {
    throw new NotFoundError(`targetMetadataTypeCode not found: ${code}`);
  }
}

async function resolveActiveQuestionTypeValueCodes(): Promise<string[] | undefined> {
  const repo = await getMetadataRepository();
  const qtType = await repo.getMetadataType(QUESTION_TYPE_METADATA_CODE);
  if (!qtType || qtType.status !== STATUS.ACTIVE) {
    return undefined;
  }
  const rows = await repo.listMetadataValues(QUESTION_TYPE_METADATA_CODE, [STATUS.ACTIVE]);
  if (rows.length === 0) {
    throw new ValidationError('QuestionType metadata has no active values; cannot validate questionType', [
      { field: 'attributes.questionType', message: 'Catalog empty' },
    ]);
  }
  return rows.map((v) => v.valueCode);
}

function metadataTypeInputToPayload(input: MetadataTypeInput): Record<string, unknown> {
  return { ...input } as Record<string, unknown>;
}

function metadataValueInputToPayload(
  input: MetadataValueInput,
  metadataTypeCode: string,
  valueCode: string,
): Record<string, unknown> {
  return {
    metadataTypeCode,
    metadataValueCode: valueCode,
    valueCode,
    label: input.label,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.isGlobal !== undefined ? { isGlobal: input.isGlobal } : {}),
    ...(input.attributes !== undefined ? { attributes: input.attributes, valueAttributes: input.attributes } : {}),
    ...(input.applicability !== undefined ? { applicability: input.applicability } : {}),
    ...(input.relationships !== undefined ? { relationships: input.relationships } : {}),
  };
}

async function validateTypeDraft(body: Record<string, unknown>, userId?: string): Promise<{
  operation: typeof CHANGE_REQUEST_OPERATION.ADD | typeof CHANGE_REQUEST_OPERATION.UPDATE;
  baseVersion: number | null;
  metadataTypeCode: string;
  proposedPayload: Record<string, unknown>;
}> {
  const normalized = normalizeMetadataTypeInput(body as MetadataTypeInput & Record<string, unknown>);
  assertMetadataTypeCode(normalized.metadataTypeCode);
  const repo = await getMetadataRepository();
  const existing = await repo.getMetadataType(normalized.metadataTypeCode);
  const actor = actorFromContext(userId);

  if (!existing) {
    validateMetadataTypeInput(normalized, false);
    await assertMetadataTypeRelationTargetExists(normalized);
    if (normalized.supportsRelations && normalized.relationType && normalized.targetMetadataTypeCode) {
      assertGovernedRelationTypeForTypes({
        relationType: normalized.relationType as RelationType,
        metadataTypeCode: normalized.metadataTypeCode,
        targetMetadataTypeCode: normalized.targetMetadataTypeCode,
      });
    }
    return {
      operation: CHANGE_REQUEST_OPERATION.ADD,
      baseVersion: null,
      metadataTypeCode: normalized.metadataTypeCode,
      proposedPayload: metadataTypeInputToPayload({
        ...normalized,
        ...(actor ? { createdBy: actor, lastModifiedBy: actor } : {}),
      }),
    };
  }

  const merged = mergeMetadataTypeForUpdate(existing, normalized);
  validateMetadataTypeInput(merged, true);
  await assertMetadataTypeRelationTargetExists(merged);
  if (merged.supportsRelations && merged.relationType && merged.targetMetadataTypeCode) {
    assertGovernedRelationTypeForTypes({
      relationType: merged.relationType as RelationType,
      metadataTypeCode: merged.metadataTypeCode,
      targetMetadataTypeCode: merged.targetMetadataTypeCode,
    });
  }
  assertPostUpsertAllowedForLatestStatus(existing.status, merged.status);
  const oldMap = attributeSchemaFieldMapForCompatibility(
    existing.attributeSchema as Record<string, unknown> | undefined,
  );
  const newMap = attributeSchemaFieldMapForCompatibility(merged.attributeSchema as Record<string, unknown> | undefined);
  if (!isAttributeSchemaCompatibleExtension(oldMap, newMap)) {
    throw new ValidationError('attributeSchema is not a compatible extension of the existing schema', [
      {
        field: 'attributeSchema',
        message: 'Cannot remove or change existing attribute definitions; only additive extensions are allowed',
      },
    ]);
  }

  return {
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    baseVersion: existing.version,
    metadataTypeCode: merged.metadataTypeCode,
    proposedPayload: metadataTypeInputToPayload({
      ...merged,
      ...(actor ? { lastModifiedBy: actor } : {}),
    }),
  };
}

async function validateValueDraft(body: Record<string, unknown>, userId?: string): Promise<{
  operation: typeof CHANGE_REQUEST_OPERATION.ADD | typeof CHANGE_REQUEST_OPERATION.UPDATE;
  baseVersion: number | null;
  metadataTypeCode: string;
  metadataValueCode: string;
  proposedPayload: Record<string, unknown>;
}> {
  const raw = body as MetadataValueInput & Record<string, unknown>;
  const metadataTypeCode = String(raw.metadataTypeCode).trim();
  const valueCode = String(raw.valueCode ?? raw.metadataValueCode).trim();
  assertMetadataTypeCode(metadataTypeCode);
  assertMetadataValueCode(valueCode);

  const repo = await getMetadataRepository();
  const existing = await repo.getMetadataValue(metadataTypeCode, valueCode);
  const type = await repo.getMetadataType(metadataTypeCode);
  if (!type) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }

  const relationshipsSent = Object.prototype.hasOwnProperty.call(raw, 'relationships');
  const normalized = normalizeMetadataValueInput(
    { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
    existing,
  );

  const relationshipTargetCodes = relationshipsSent
    ? (normalized.relationships ?? []).map((x) => x.targetMetadataValueCode)
    : undefined;

  validateValueRelationshipsPayload(type, {
    mode: existing ? 'update' : 'create',
    relationshipsSent,
    targetCodes: relationshipsSent ? relationshipTargetCodes ?? [] : undefined,
  });

  if (relationshipsSent && relationshipTargetCodes?.length) {
    await assertRelationshipTargetsReferenceValidValues(repo, type, relationshipTargetCodes);
  }

  const allowedQuestionTypeCodes =
    metadataTypeCode === 'QuestionCode' ? await resolveActiveQuestionTypeValueCodes() : undefined;

  if (!existing) {
    assertMetadataTypeActiveForValueMutation(type, metadataTypeCode);
    validateMetadataValueInput(normalized, {
      metadataType: type,
      mode: 'create',
      mergedIsGlobal: normalized.isGlobal!,
      allowedQuestionTypeCodes,
    });
    return {
      operation: CHANGE_REQUEST_OPERATION.ADD,
      baseVersion: null,
      metadataTypeCode,
      metadataValueCode: valueCode,
      proposedPayload: metadataValueInputToPayload(normalized, metadataTypeCode, valueCode),
    };
  }

  if (existing.status === STATUS.DELETED) {
    throw new ConflictError(`Value ${valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
  }

  assertMetadataTypeActiveForValueMutation(type, metadataTypeCode);
  assertPostUpsertAllowedForLatestStatus(existing.status, normalized.status);
  const mergedIsGlobal = normalized.isGlobal ?? existing.isGlobal;
  validateMetadataValueInput(normalized, {
    metadataType: type,
    mode: 'update',
    mergedIsGlobal,
    expectedValueCode: existing.valueCode,
    allowedQuestionTypeCodes,
  });

  const { relationships: _relationships, ...valueBody } = normalized;
  return {
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    baseVersion: existing.version,
    metadataTypeCode,
    metadataValueCode: valueCode,
    proposedPayload: metadataValueInputToPayload(valueBody, metadataTypeCode, valueCode),
  };
}

/** Shared validation + payload preparation for draft save and stateless impact preview. */
export async function prepareTypeRegistryChange(body: Record<string, unknown>, userId?: string): Promise<{
  operation: typeof CHANGE_REQUEST_OPERATION.ADD | typeof CHANGE_REQUEST_OPERATION.UPDATE;
  baseVersion: number | null;
  metadataTypeCode: string;
  proposedPayload: Record<string, unknown>;
}> {
  return validateTypeDraft(body, userId);
}

/** Shared validation + payload preparation for draft save and stateless impact preview. */
export async function prepareValueRegistryChange(body: Record<string, unknown>, userId?: string): Promise<{
  operation: typeof CHANGE_REQUEST_OPERATION.ADD | typeof CHANGE_REQUEST_OPERATION.UPDATE;
  baseVersion: number | null;
  metadataTypeCode: string;
  metadataValueCode: string;
  proposedPayload: Record<string, unknown>;
}> {
  return validateValueDraft(body, userId);
}

/**
 * POST `/metadata/:entityType?action=draft` — validate and persist change request only.
 */
export async function orchestrateRegistryPostDraft(
  input: RegistryPostMetadataInput,
): Promise<ChangeRequestDraftResponse> {
  const repo = await getMetadataRepository();
  const actor = actorFromContext(input.userId);
  const now = new Date().toISOString();
  const changeRequestId = ulid();

  if (input.entityType === 'type') {
    const prepared = await validateTypeDraft(input.body, input.userId);
    const record: ChangeRequestRecord = {
      changeRequestId,
      status: CHANGE_REQUEST_STATUS.DRAFT,
      entityType: 'type',
      operation: prepared.operation,
      metadataTypeCode: prepared.metadataTypeCode,
      baseVersion: prepared.baseVersion,
      proposedPayload: prepared.proposedPayload,
      createdAt: now,
      createdBy: actor,
      lastModifiedAt: now,
      lastModifiedBy: actor,
    };
    const saved = await repo.saveChangeRequestDraft(record);
    return toChangeRequestDraftResponse(saved);
  }

  const prepared = await validateValueDraft(input.body, input.userId);
  const record: ChangeRequestRecord = {
    changeRequestId,
    status: CHANGE_REQUEST_STATUS.DRAFT,
    entityType: 'value',
    operation: prepared.operation,
    metadataTypeCode: prepared.metadataTypeCode,
    metadataValueCode: prepared.metadataValueCode,
    baseVersion: prepared.baseVersion,
    proposedPayload: prepared.proposedPayload,
    createdAt: now,
    createdBy: actor,
    lastModifiedAt: now,
    lastModifiedBy: actor,
  };
  const saved = await repo.saveChangeRequestDraft(record);
  return toChangeRequestDraftResponse(saved);
}
