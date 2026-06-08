import { ValidationError } from '../domain/errors';
import { getMetadataRepository, getRelationRepository } from '../dynamodb/dynamodb.client';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
} from '../models/change-request.types';
import type { MetadataPublishResult } from '../models/publish.types';
import type { MetadataTypeInput, MetadataValueInput } from '../models/types';
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
  syncMetadataValueRelationships,
  validateValueRelationshipsPayload,
} from './metadata-value-relation.service';
import type { RegistryPostMetadataPublishInput } from './metadata.service.types';
import {
  evaluateRegistryChangeImpact,
  loadPublishedBasePayload,
  toImpactSummary,
} from './metadata-registry-change.shared';

function assertChangeRequestId(body: Record<string, unknown>): string {
  const id = body.changeRequestId;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ValidationError('changeRequestId is required for publish', [
      { field: 'changeRequestId', message: 'Required' },
    ]);
  }
  return id.trim();
}

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

/**
 * Publish a DRAFT change request with selective metadata versioning.
 * Add → v1 + latest pointer. Update + requiresMetadataVersion=false → IN_PLACE. Otherwise NEW_VERSION.
 */
export async function publishChangeRequest(
  changeRequestId: string,
  userId?: string,
): Promise<MetadataPublishResult> {
  const repo = await getMetadataRepository();
  const actor = actorFromContext(userId);
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
  if (draft.operation === CHANGE_REQUEST_OPERATION.UPDATE) {
    const published = await loadPublishedBasePayload(
      draft.entityType,
      draft.metadataTypeCode,
      draft.metadataValueCode,
    );
    basePayload = published.basePayload;
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

    await repo.markChangeRequestPublished(changeRequestId, { actor, publishedAt: now });

    return {
      changeRequestId,
      entityType: 'type',
      operation: draft.operation,
      metadataTypeCode: draft.metadataTypeCode,
      metadataValueCode: null,
      publishStrategy,
      version: record.version,
      impactSummary: toImpactSummary(impact),
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

  const { relationships: _relationships, ...valueBody } = input;
  let record;
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

  await repo.markChangeRequestPublished(changeRequestId, { actor, publishedAt: now });

  return {
    changeRequestId,
    entityType: 'value',
    operation: draft.operation,
    metadataTypeCode: draft.metadataTypeCode,
    metadataValueCode: valueCode,
    publishStrategy,
    version: record.version,
    impactSummary: toImpactSummary(impact),
    record,
  };
}

/**
 * POST `/metadata/:entityType?action=publish` — publish a saved draft (Ticket 5 internal orchestration).
 */
export async function orchestrateRegistryPostPublish(
  input: RegistryPostMetadataPublishInput,
): Promise<MetadataPublishResult> {
  return publishChangeRequest(assertChangeRequestId(input.body), input.userId);
}
