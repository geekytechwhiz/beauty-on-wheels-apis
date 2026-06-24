import { monotonicFactory } from 'ulid';

import { STATUS } from '../constants';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  assertMetadataTypeActiveForValueMutation,
} from '../domain/errors';
import { getChangePolicyCatalog, matchPolicyRules } from '../change-policy';
import { flattenMetadataValueForApi } from '../mappers/metadata-request.mapper';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  type ChangeRequestDraftResponse,
  type ChangeRequestRecord,
  toChangeRequestDraftResponse,
} from '../models/change-request.types';
import type { ImpactPreviewResponse } from '../models/impact-preview.types';
import type { MetadataPublishResponse } from '../models/publish.types';
import type { MetadataValueRecord } from '../models/types';
import { assertMetadataTypeCode, assertMetadataValueCode } from '../validators/code-patterns';
import {
  assertChangeRequestIdPresentOnBody,
  assertMetadataPublishRequestBody,
} from '../validators/registry-route.validation';
import { getMetadataRepository } from '../dynamodb/dynamodb.client';
import type { RegistryDeleteMetadataValueInput } from './metadata.service.types';
import {
  buildConsumerGatedImpact,
  evaluateRegistryChangeImpact,
  loadPublishedBasePayload,
} from './metadata-registry-change.shared';
import { publishChangeRequest, shapeMetadataPublishResponse } from './metadata-publish.service';

const ulid = monotonicFactory();

function actorFromContext(userId?: string): string | undefined {
  return userId;
}

function isDraftPreviewBody(body: Record<string, unknown>): boolean {
  const id = body.changeRequestId;
  return typeof id === 'string' && id.trim() !== '';
}

function buildValueRetirePayload(existing: MetadataValueRecord, reason?: string): Record<string, unknown> {
  const flat = flattenMetadataValueForApi(existing);
  return {
    metadataTypeCode: existing.metadataTypeCode,
    metadataValueCode: existing.valueCode,
    valueCode: existing.valueCode,
    label: flat.label,
    ...(flat.description !== undefined ? { description: flat.description } : {}),
    sortOrder: flat.sortOrder,
    status: STATUS.DELETED,
    isGlobal: flat.isGlobal,
    valueAttributes: flat.valueAttributes,
    applicableModules: flat.applicableModules,
    applicableCategories: flat.applicableCategories,
    applicableConditions: flat.applicableConditions,
    applicableCountries: flat.applicableCountries,
    applicableLanguages: flat.applicableLanguages,
    ...(reason !== undefined ? { deleteReason: reason } : {}),
  };
}

async function loadValueForRetire(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord> {
  assertMetadataTypeCode(metadataTypeCode);
  assertMetadataValueCode(valueCode);
  const repo = await getMetadataRepository();
  const existing = await repo.getMetadataValue(metadataTypeCode, valueCode);
  if (!existing) {
    throw new NotFoundError(`Value ${valueCode} not found`);
  }
  if (existing.status === STATUS.DELETED) {
    throw new ConflictError(`Value ${valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
  }
  const typeRecord = await repo.getMetadataType(metadataTypeCode);
  if (!typeRecord) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  assertMetadataTypeActiveForValueMutation(typeRecord, metadataTypeCode);
  return existing;
}

export async function prepareValueRetireChange(
  metadataTypeCode: string,
  valueCode: string,
  reason?: string,
): Promise<{
  operation: typeof CHANGE_REQUEST_OPERATION.UPDATE;
  baseVersion: number;
  metadataTypeCode: string;
  metadataValueCode: string;
  proposedPayload: Record<string, unknown>;
}> {
  const existing = await loadValueForRetire(metadataTypeCode, valueCode);
  return {
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    baseVersion: existing.version,
    metadataTypeCode,
    metadataValueCode: valueCode,
    proposedPayload: buildValueRetirePayload(existing, reason),
  };
}

async function buildRetireImpactPreviewResponse(params: {
  changeRequestId?: string;
  baseVersion: number;
  basePayload: Record<string, unknown>;
  proposedPayload: Record<string, unknown>;
  metadataTypeCode: string;
  metadataValueCode: string;
}): Promise<ImpactPreviewResponse> {
  const catalog = getChangePolicyCatalog();
  const impact = evaluateRegistryChangeImpact({
    entityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.metadataValueCode,
    basePayload: params.basePayload,
    proposedPayload: params.proposedPayload,
  });

  const matches = matchPolicyRules(catalog, impact.changes);
  const changedFields = matches.map(({ rule, change }) => ({
    objectPath: change.objectPath,
    operation: change.operation,
    oldValue: change.oldValue ?? null,
    newValue: change.newValue ?? null,
    policyGroup: rule.policyGroup,
  }));

  const gated = await buildConsumerGatedImpact({
    entityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.metadataValueCode,
    policyImpact: impact,
  });

  return {
    entityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.metadataValueCode,
    changeRequestId: params.changeRequestId ?? null,
    baseVersion: params.baseVersion,
    nextVersion: impact.requiresMetadataVersion ? params.baseVersion + 1 : params.baseVersion,
    changedFields,
    impactSummary: gated.impactSummary,
    confirmationRequired: gated.confirmationRequired,
    affectedConsumers: gated.affectedConsumers,
  };
}

function assertRetireDraftEntityMatch(
  draft: ChangeRequestRecord,
  metadataTypeCode: string,
  valueCode: string,
): void {
  if (draft.entityType !== 'value') {
    throw new ValidationError('Change request is not a value retire draft', [
      { field: 'changeRequestId', message: 'Must be a value entity retire draft' },
    ]);
  }
  if (draft.metadataTypeCode !== metadataTypeCode || draft.metadataValueCode !== valueCode) {
    throw new ValidationError('Change request does not match the metadata value in the path', [
      { field: 'changeRequestId', message: 'Entity mismatch' },
    ]);
  }
  const proposedStatus = String(draft.proposedPayload.status ?? '').trim().toUpperCase();
  if (proposedStatus !== STATUS.DELETED) {
    throw new ValidationError('Change request is not a retire (soft delete) draft', [
      { field: 'changeRequestId', message: 'Proposed status must be DELETED' },
    ]);
  }
}

/**
 * PATCH `/metadata-values/.../delete?action=draft` — save retire change request without soft deleting.
 */
export async function orchestrateRegistryDeleteMetadataValueDraft(
  input: RegistryDeleteMetadataValueInput,
): Promise<ChangeRequestDraftResponse> {
  const prepared = await prepareValueRetireChange(input.metadataTypeCode, input.valueCode, input.reason);
  const repo = await getMetadataRepository();
  const actor = actorFromContext(input.userId);
  const now = new Date().toISOString();
  const changeRequestId = ulid();

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

/**
 * PATCH `/metadata-values/.../delete?action=impact-preview` — preview retire impact.
 */
export async function orchestrateRegistryDeleteMetadataValueImpactPreview(
  input: RegistryDeleteMetadataValueInput,
): Promise<ImpactPreviewResponse> {
  const body = input.body ?? {};

  if (isDraftPreviewBody(body)) {
    const changeRequestId = assertChangeRequestIdPresentOnBody(body);
    const repo = await getMetadataRepository();
    const draft = await repo.getChangeRequest(changeRequestId);
    if (!draft) {
      throw new ValidationError(`Change request not found: ${changeRequestId}`, [
        { field: 'changeRequestId', message: 'Not found' },
      ]);
    }
    if (draft.status !== CHANGE_REQUEST_STATUS.DRAFT) {
      throw new ValidationError(`Change request ${changeRequestId} is not in DRAFT status`, [
        { field: 'changeRequestId', message: 'Must be DRAFT' },
      ]);
    }
    assertRetireDraftEntityMatch(draft, input.metadataTypeCode, input.valueCode);

    const published = await loadPublishedBasePayload('value', draft.metadataTypeCode, draft.metadataValueCode);
    if (!published.basePayload) {
      throw new ValidationError(`Published value not found: ${draft.metadataValueCode}`, [
        { field: 'changeRequestId', message: 'Base entity missing' },
      ]);
    }

    return buildRetireImpactPreviewResponse({
      changeRequestId: draft.changeRequestId,
      baseVersion: published.baseVersion ?? draft.baseVersion ?? 0,
      basePayload: published.basePayload,
      proposedPayload: draft.proposedPayload,
      metadataTypeCode: draft.metadataTypeCode,
      metadataValueCode: draft.metadataValueCode!,
    });
  }

  const prepared = await prepareValueRetireChange(input.metadataTypeCode, input.valueCode, input.reason);
  const published = await loadPublishedBasePayload('value', prepared.metadataTypeCode, prepared.metadataValueCode);
  if (!published.basePayload) {
    throw new ValidationError(`Published value not found: ${prepared.metadataValueCode}`, [
      { field: 'metadataValueCode', message: 'Not found' },
    ]);
  }

  return buildRetireImpactPreviewResponse({
    baseVersion: published.baseVersion ?? prepared.baseVersion,
    basePayload: published.basePayload,
    proposedPayload: prepared.proposedPayload,
    metadataTypeCode: prepared.metadataTypeCode,
    metadataValueCode: prepared.metadataValueCode,
  });
}

/**
 * PATCH `/metadata-values/.../delete?action=publish` — publish a saved retire draft (soft delete).
 */
export async function orchestrateRegistryDeleteMetadataValuePublish(
  input: RegistryDeleteMetadataValueInput,
): Promise<MetadataPublishResponse> {
  const publishRequest = assertMetadataPublishRequestBody(input.body ?? {});
  const repo = await getMetadataRepository();
  const draft = await repo.getChangeRequest(publishRequest.changeRequestId);
  if (!draft) {
    throw new ValidationError(`Change request not found: ${publishRequest.changeRequestId}`, [
      { field: 'changeRequestId', message: 'Not found' },
    ]);
  }
  assertRetireDraftEntityMatch(draft, input.metadataTypeCode, input.valueCode);

  const result = await publishChangeRequest(publishRequest, input.userId);
  return shapeMetadataPublishResponse(result);
}
