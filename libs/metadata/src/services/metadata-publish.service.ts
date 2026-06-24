import { ValidationError, ConflictError } from '../domain/errors';
import { STATUS } from '../constants';
import { getMetadataRepository, getRelationRepository } from '../dynamodb/dynamodb.client';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
} from '../models/change-request.types';
import type { MetadataPublishResult, MetadataPublishResponse } from '../models/publish.types';
import type { MetadataTypeInput, MetadataValueInput, MetadataTypeRecord, MetadataValueRecord } from '../models/types';
import { flattenMetadataValueForApi } from '../mappers/metadata-request.mapper';
import {
  mergeMetadataTypeForUpdate,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
} from '../mappers/metadata-request.mapper';
import {
  PUBLISH_VERSION_STRATEGY,
  resolvePublishVersionStrategy,
  shouldSyncApplicabilityOnPublish,
} from '../publish/publish-version.strategy';
import {
  assertRelationshipTargetsReferenceValidValues,
  inactivateAllRelationsInvolvingMetadataValue,
  resolveRelationshipsForApi,
  syncMetadataValueRelationships,
  validateValueRelationshipsPayload,
} from './metadata-value-relation.service';
import type { RegistryPostMetadataPublishInput } from './metadata.service.types';
import {
  buildConsumerGatedImpact,
  evaluateRegistryChangeImpact,
  loadPublishedBasePayload,
} from './metadata-registry-change.shared';
import {
  assertMetadataPublishRequestBody,
  type MetadataPublishRequestBody,
} from '../validators/registry-route.validation';

function payloadToMetadataTypeInput(payload: Record<string, unknown>): MetadataTypeInput {
  return normalizeMetadataTypeInput(payload as MetadataTypeInput & Record<string, unknown>);
}

function payloadToMetadataValueInput(
  payload: Record<string, unknown>,
  existing: import('../models/types').MetadataValueRecord | null,
): MetadataValueInput {
  return normalizeMetadataValueInput(
    payload as MetadataValueInput & Record<string, unknown>,
    existing,
  );
}

function actorFromContext(userId?: string): string | undefined {
  return userId;
}

function isRetireProposedPayload(payload: Record<string, unknown>): boolean {
  return String(payload.status ?? '').trim().toUpperCase() === STATUS.DELETED;
}

function assertPublishConfirmation(
  confirmationRequired: boolean,
  confirmationAcknowledged: boolean,
): void {
  if (confirmationRequired && !confirmationAcknowledged) {
    throw new ValidationError(
      'confirmationAcknowledged must be true for breaking or high-impact changes',
      [{ field: 'confirmationAcknowledged', message: 'Required for this publish' }],
    );
  }
}

function assertExpectedBaseVersionForPublish(
  operation: typeof CHANGE_REQUEST_OPERATION.ADD | typeof CHANGE_REQUEST_OPERATION.UPDATE,
  expectedBaseVersion: number | null,
  currentPublishedVersion: number | null,
): void {
  if (operation === CHANGE_REQUEST_OPERATION.ADD) {
    if (expectedBaseVersion !== null) {
      throw new ValidationError('expectedBaseVersion must be null for Add operation', [
        { field: 'expectedBaseVersion', message: 'Must be null for Add' },
      ]);
    }
    return;
  }

  if (expectedBaseVersion !== currentPublishedVersion) {
    throw new ConflictError(
      `Published version mismatch: expected ${expectedBaseVersion}, current is ${currentPublishedVersion ?? 'none'}`,
      'EXPECTED_BASE_VERSION_MISMATCH',
    );
  }
}

export async function shapeMetadataPublishResponse(result: MetadataPublishResult): Promise<MetadataPublishResponse> {
  if (result.entityType === 'type') {
    return {
      changeRequestId: result.changeRequestId,
      changeRevision: result.changeRevision,
      entityType: result.entityType,
      operation: result.operation,
      metadataTypeCode: result.metadataTypeCode,
      metadataValueCode: result.metadataValueCode,
      publishStrategy: result.publishStrategy,
      version: result.version,
      impactSummary: result.impactSummary,
      published: result.record as MetadataTypeRecord,
    };
  }

  const record = result.record as MetadataValueRecord;
  const meta = await getMetadataRepository();
  const rel = await getRelationRepository();
  const typeRecord = await meta.getMetadataType(record.metadataTypeCode);
  const flat = flattenMetadataValueForApi(record);
  const published =
    typeRecord?.supportsRelations
      ? {
          ...flat,
          relationships: await resolveRelationshipsForApi(meta, rel, typeRecord, record),
        }
      : flat;

  return {
    changeRequestId: result.changeRequestId,
    changeRevision: result.changeRevision,
    entityType: result.entityType,
    operation: result.operation,
    metadataTypeCode: result.metadataTypeCode,
    metadataValueCode: result.metadataValueCode,
    publishStrategy: result.publishStrategy,
    version: result.version,
    impactSummary: result.impactSummary,
    published,
  };
}

/**
 * Publish a DRAFT change request with selective metadata versioning.
 * Add → v1 + latest pointer. Update + requiresMetadataVersion=false → IN_PLACE. Otherwise NEW_VERSION.
 */
export async function publishChangeRequest(
  request: MetadataPublishRequestBody,
  userId?: string,
): Promise<MetadataPublishResult> {
  const repo = await getMetadataRepository();
  const actor = actorFromContext(userId);
  const changeRequestId = request.changeRequestId;
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

  let basePayload: Record<string, unknown> | null = null;
  let currentPublishedVersion: number | null = null;
  if (draft.operation === CHANGE_REQUEST_OPERATION.UPDATE) {
    const published = await loadPublishedBasePayload(
      draft.entityType,
      draft.metadataTypeCode,
      draft.metadataValueCode,
    );
    basePayload = published.basePayload;
    currentPublishedVersion = published.baseVersion;
    if (basePayload === null) {
      throw new ValidationError(
        `Published ${draft.entityType} not found for update publish: ${draft.metadataTypeCode}`,
        [{ field: 'changeRequestId', message: 'Base entity missing' }],
      );
    }
  }

  const impact = evaluateRegistryChangeImpact({
    entityType: draft.entityType,
    operation: draft.operation,
    metadataTypeCode: draft.metadataTypeCode,
    metadataValueCode: draft.metadataValueCode,
    basePayload,
    proposedPayload: draft.proposedPayload,
  });

  const gated = await buildConsumerGatedImpact({
    entityType: draft.entityType,
    operation: draft.operation,
    metadataTypeCode: draft.metadataTypeCode,
    metadataValueCode: draft.metadataValueCode,
    policyImpact: impact,
  });

  assertPublishConfirmation(gated.confirmationRequired, request.confirmationAcknowledged);
  assertExpectedBaseVersionForPublish(
    draft.operation,
    request.expectedBaseVersion,
    currentPublishedVersion,
  );

  const impactSummary = gated.impactSummary;
  const publishStrategy = resolvePublishVersionStrategy(draft.operation, impact.requiresMetadataVersion);
  const syncApplicability = shouldSyncApplicabilityOnPublish(impact.changes);
  const now = new Date().toISOString();

  if (draft.entityType === 'type') {
    const input = payloadToMetadataTypeInput(draft.proposedPayload);
    let record;
    if (draft.operation === CHANGE_REQUEST_OPERATION.ADD) {
      record = await repo.createMetadataType(input, actor);
    } else {
      const existing = await repo.getMetadataType(draft.metadataTypeCode);
      if (!existing) {
        throw new ValidationError(`Metadata type ${draft.metadataTypeCode} not found`, [
          { field: 'metadataTypeCode', message: 'Not found' },
        ]);
      }
      const merged = mergeMetadataTypeForUpdate(existing, input);
      record =
        publishStrategy === PUBLISH_VERSION_STRATEGY.IN_PLACE
          ? await repo.updateMetadataTypeInPlace(merged, actor, existing)
          : await repo.updateMetadataType(merged, actor);
    }

    const publishedDraft = await repo.markChangeRequestPublished(changeRequestId, { actor, publishedAt: now });

    return {
      changeRequestId,
      changeRevision: publishedDraft.changeRevision!,
      entityType: 'type',
      operation: draft.operation,
      metadataTypeCode: draft.metadataTypeCode,
      metadataValueCode: null,
      publishStrategy,
      version: record.version,
      impactSummary,
      record,
    };
  }

  const valueCode = draft.metadataValueCode!;
  const existing = await repo.getMetadataValue(draft.metadataTypeCode, valueCode);
  const input = payloadToMetadataValueInput(draft.proposedPayload, existing);
  const type = await repo.getMetadataType(draft.metadataTypeCode);
  if (!type) {
    throw new ValidationError(`Metadata type ${draft.metadataTypeCode} not found`, [
      { field: 'metadataTypeCode', message: 'Not found' },
    ]);
  }

  const relationshipsSent = Object.prototype.hasOwnProperty.call(draft.proposedPayload, 'relationships');
  const relationshipTargetCodes = relationshipsSent
    ? (input.relationships ?? []).map((x) => x.targetMetadataValueCode)
    : undefined;

  validateValueRelationshipsPayload(type, {
    mode: existing ? 'update' : 'create',
    relationshipsSent,
    targetCodes: relationshipsSent ? relationshipTargetCodes ?? [] : undefined,
  });

  if (relationshipsSent && relationshipTargetCodes?.length) {
    await assertRelationshipTargetsReferenceValidValues(repo, type, relationshipTargetCodes);
  }

  let record: MetadataValueRecord;

  if (isRetireProposedPayload(draft.proposedPayload)) {
    if (draft.operation !== CHANGE_REQUEST_OPERATION.UPDATE || !existing) {
      throw new ValidationError(`Value ${valueCode} not found`, [{ field: 'metadataValueCode', message: 'Not found' }]);
    }
    const deleteReason =
      typeof draft.proposedPayload.deleteReason === 'string'
        ? draft.proposedPayload.deleteReason
        : undefined;
    record = await repo.softDeleteMetadataValue(draft.metadataTypeCode, valueCode, {
      reason: deleteReason,
      actor,
    });
    const relRepo = await getRelationRepository();
    await inactivateAllRelationsInvolvingMetadataValue(
      repo,
      relRepo,
      draft.metadataTypeCode,
      valueCode,
      actor,
    );
  } else {
    const valueBody = { ...input };
    delete valueBody.relationships;

    if (draft.operation === CHANGE_REQUEST_OPERATION.ADD) {
      record = await repo.createMetadataValue(draft.metadataTypeCode, valueBody, actor);
    } else if (!existing) {
      throw new ValidationError(`Value ${valueCode} not found`, [{ field: 'metadataValueCode', message: 'Not found' }]);
    } else if (publishStrategy === PUBLISH_VERSION_STRATEGY.IN_PLACE) {
      record = await repo.updateMetadataValueInPlace(
        draft.metadataTypeCode,
        valueBody,
        actor,
        existing,
        { syncApplicability },
      );
    } else {
      record = await repo.updateMetadataValue(draft.metadataTypeCode, valueBody, actor, existing);
    }
  }

  if (!isRetireProposedPayload(draft.proposedPayload) && record.status === STATUS.INACTIVE) {
    const relRepo = await getRelationRepository();
    await inactivateAllRelationsInvolvingMetadataValue(
      repo,
      relRepo,
      draft.metadataTypeCode,
      valueCode,
      actor,
    );
  }

  if (relationshipsSent) {
    const relRepo = await getRelationRepository();
    await syncMetadataValueRelationships(
      repo,
      relRepo,
      type,
      record.valueCode,
      relationshipsSent,
      relationshipTargetCodes ?? [],
      actor,
    );
  }

  const publishedDraft = await repo.markChangeRequestPublished(changeRequestId, { actor, publishedAt: now });

  return {
    changeRequestId,
    changeRevision: publishedDraft.changeRevision!,
    entityType: 'value',
    operation: draft.operation,
    metadataTypeCode: draft.metadataTypeCode,
    metadataValueCode: valueCode,
    publishStrategy,
    version: record.version,
    impactSummary,
    record,
  };
}

/**
 * POST `/metadata/:entityType?action=publish` — publish a saved draft change request.
 */
export async function orchestrateRegistryPostPublish(
  input: RegistryPostMetadataPublishInput,
): Promise<MetadataPublishResponse> {
  const publishRequest = assertMetadataPublishRequestBody(input.body);
  const repo = await getMetadataRepository();
  const draft = await repo.getChangeRequest(publishRequest.changeRequestId);
  if (!draft) {
    throw new ValidationError(`Change request not found: ${publishRequest.changeRequestId}`, [
      { field: 'changeRequestId', message: 'Not found' },
    ]);
  }
  if (draft.entityType !== input.entityType) {
    throw new ValidationError(
      `Change request entityType ${draft.entityType} does not match path entityType ${input.entityType}`,
      [{ field: 'entityType', message: 'Mismatch with change request' }],
    );
  }

  const result = await publishChangeRequest(publishRequest, input.userId);
  return shapeMetadataPublishResponse(result);
}
