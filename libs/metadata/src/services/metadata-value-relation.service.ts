import { STATUS } from '../constants';
import { NotFoundError, ValidationError } from '../domain/errors';
import { relationPartitionKey, relationSortKey } from '../domain/relation-keys';
import { resolveRelationStorageEndpoints } from '../domain/metadata-relation-orientation';
import type {
  MetadataTypeRecord,
  MetadataValueRelationshipResolved,
  MetadataValueRecord,
} from '../models/types';
import type {
  CreateMetadataRelationInput,
  MetadataRelationRecord,
  RelationType,
} from '../models/relation-types';
import { RELATION_STATUS } from '../models/relation-types';
import type { IMetadataRegistryRepository } from '../repositories/metadata-registry.repository.interface';
import type { IRelationRepository } from '../repositories/relation.repository.interface';
import {
  RELATION_TYPE_ALLOWED_PAIRS,
  assertRelationEndpointsExist,
  skBeginsWithForListFilter,
} from '../validators/relation';
import { assertMetadataValueCode } from '../validators/code-patterns';

function neighborRelatedValueCode(
  rel: MetadataRelationRecord,
  subjectMetadataTypeCode: string,
  subjectValueCode: string,
): string {
  if (
    rel.fromMetadataTypeCode === subjectMetadataTypeCode &&
    rel.fromMetadataValueCode === subjectValueCode
  ) {
    return rel.toMetadataValueCode;
  }
  if (
    rel.toMetadataTypeCode === subjectMetadataTypeCode &&
    rel.toMetadataValueCode === subjectValueCode
  ) {
    return rel.fromMetadataValueCode;
  }
  throw new ValidationError(
    'Relationship validation failed due to inconsistent related metadata configuration.',
    [
      {
        field: 'relationships',
        message: 'Related values do not match the expected relationship shape for this metadata value.',
      },
    ],
  );
}

/**
 * Lists relation rows for a subject metadata value (forward or reverse storage per type config).
 * @param includeInactiveRelations When false (default), only ACTIVE relations. When true, ACTIVE and INACTIVE.
 */
export async function listRelationsForSubjectValue(
  meta: IMetadataRegistryRepository,
  rel: IRelationRepository,
  typeRecord: MetadataTypeRecord,
  subjectValueCode: string,
  includeInactiveRelations: boolean,
): Promise<MetadataRelationRecord[]> {
  if (!typeRecord.supportsRelations || !typeRecord.relationType || !typeRecord.targetMetadataTypeCode) {
    return [];
  }
  const rt = typeRecord.relationType;
  const targetType = typeRecord.targetMetadataTypeCode;
  const subjectType = typeRecord.metadataTypeCode;
  const pairs = RELATION_TYPE_ALLOWED_PAIRS[rt];
  const forward = pairs.find((p) => p.from === subjectType && p.to === targetType);
  if (forward) {
    const skBeginsWith = skBeginsWithForListFilter(rt, targetType);
    return rel.listRelationsByFrom(subjectType, subjectValueCode, {
      skBeginsWith,
      status: includeInactiveRelations ? 'ALL' : undefined,
    });
  }
  const reverse = pairs.find((p) => p.from === targetType && p.to === subjectType);
  if (!reverse) {
    return [];
  }
  const candidates = await meta.listMetadataValues(targetType, [STATUS.ACTIVE]);
  const out: MetadataRelationRecord[] = [];
  for (const v of candidates) {
    const pk = relationPartitionKey(targetType, v.valueCode);
    const sk = relationSortKey(rt, subjectType, subjectValueCode);
    const row = await rel.getRelationByKey(pk, sk);
    if (!row) {
      continue;
    }
    const st = row.status ?? RELATION_STATUS.ACTIVE;
    if (!includeInactiveRelations && st !== RELATION_STATUS.ACTIVE) {
      continue;
    }
    out.push(row);
  }
  return out;
}

/** Active relation rows only (used by sync / inactivation helpers). */
export async function listActiveRelationsForSubjectValue(
  meta: IMetadataRegistryRepository,
  rel: IRelationRepository,
  typeRecord: MetadataTypeRecord,
  subjectValueCode: string,
): Promise<MetadataRelationRecord[]> {
  return listRelationsForSubjectValue(meta, rel, typeRecord, subjectValueCode, false);
}

export async function resolveRelationshipsForApi(
  meta: IMetadataRegistryRepository,
  rel: IRelationRepository,
  typeRecord: MetadataTypeRecord,
  valueRecord: MetadataValueRecord,
  options?: { includeInactiveRelations?: boolean },
): Promise<MetadataValueRelationshipResolved[]> {
  if (!typeRecord.supportsRelations || !typeRecord.targetMetadataTypeCode || !typeRecord.relationType) {
    return [];
  }
  const includeInactive = options?.includeInactiveRelations ?? false;
  const relRows = await listRelationsForSubjectValue(
    meta,
    rel,
    typeRecord,
    valueRecord.valueCode,
    includeInactive,
  );
  const targetType = typeRecord.targetMetadataTypeCode;
  const out: MetadataValueRelationshipResolved[] = [];
  for (const r of relRows) {
    const code = neighborRelatedValueCode(r, typeRecord.metadataTypeCode, valueRecord.valueCode);
    const val = await meta.getMetadataValue(targetType, code);
    if (!val || val.status === STATUS.DELETED) {
      continue;
    }
    const relationStatus = r.status ?? RELATION_STATUS.ACTIVE;
    out.push({
      relationId: r.id,
      relationStatus,
      metadataTypeCode: targetType,
      metadataValueCode: code,
      label: val.label,
    });
  }
  return out;
}

async function ensureRelation(
  rel: IRelationRepository,
  meta: IMetadataRegistryRepository,
  input: CreateMetadataRelationInput,
  actor?: string,
): Promise<MetadataRelationRecord> {
  await assertRelationEndpointsExist(meta, input);
  const pk = relationPartitionKey(input.fromMetadataTypeCode, input.fromMetadataValueCode);
  const sk = relationSortKey(
    input.relationType,
    input.toMetadataTypeCode,
    input.toMetadataValueCode,
  );
  const existing = await rel.getRelationByKey(pk, sk);
  if (!existing) {
    try {
      return await rel.createRelation({ ...input, createdBy: actor }, actor);
    } catch (e: unknown) {
      const n = (e as { name?: string })?.name;
      const msg = String((e as { message?: string })?.message ?? '');
      if (n === 'ConflictError' || msg.includes('already exists')) {
        const again = await rel.getRelationByKey(pk, sk);
        if (again && again.status !== RELATION_STATUS.ACTIVE) {
          return rel.reactivateRelation(pk, sk, actor);
        }
      }
      throw e;
    }
  }
  if (existing.status === RELATION_STATUS.ACTIVE) {
    return existing;
  }
  return rel.reactivateRelation(pk, sk, actor);
}

export interface ValidateValueRelationshipsOpts {
  mode: 'create' | 'update';
  relationshipsSent: boolean;
  /** Target codes when `relationships` was present on the request (may be empty array). */
  targetCodes: string[] | undefined;
}

export function validateValueRelationshipsPayload(
  typeRecord: MetadataTypeRecord,
  opts: ValidateValueRelationshipsOpts,
): void {
  const { relationshipsSent, targetCodes, mode } = opts;
  if (!typeRecord.supportsRelations) {
    if (relationshipsSent && targetCodes && targetCodes.length > 0) {
      throw new ValidationError('This metadata type does not support relationships', [
        { field: 'relationships', message: 'Not supported for this metadata type' },
      ]);
    }
    return;
  }

  const targets = targetCodes ?? [];
  if (typeRecord.relationRequired) {
    if (mode === 'create') {
      if (!relationshipsSent || targets.length === 0) {
        throw new ValidationError('relationships is required for this metadata type', [
          { field: 'relationships', message: 'Required' },
        ]);
      }
    } else if (relationshipsSent && targets.length === 0) {
      throw new ValidationError('relationships cannot be empty for this metadata type', [
        { field: 'relationships', message: 'Required' },
      ]);
    }
  }

  if (!relationshipsSent) {
    return;
  }

  if (typeRecord.selectionMode === 'SINGLE' && targets.length > 1) {
    throw new ValidationError('Only one relationship is allowed (SINGLE selection mode)', [
      { field: 'relationships', message: 'At most one target allowed' },
    ]);
  }
}

export async function assertRelationshipTargetsReferenceValidValues(
  meta: IMetadataRegistryRepository,
  typeRecord: MetadataTypeRecord,
  targetCodes: string[],
): Promise<void> {
  if (!typeRecord.supportsRelations || !typeRecord.targetMetadataTypeCode) {
    return;
  }
  const tt = typeRecord.targetMetadataTypeCode;
  for (const code of targetCodes) {
    assertMetadataValueCode(code, 'relationships.targetMetadataValueCode');
    const v = await meta.getMetadataValue(tt, code);
    if (!v) {
      throw new NotFoundError(`Related metadata value not found: ${tt} / ${code}`);
    }
    if (v.status !== STATUS.ACTIVE) {
      throw new ValidationError(`Related metadata value must be active: ${tt} / ${code}`, [
        { field: 'relationships', message: 'Target value is not active' },
      ]);
    }
  }
}

export async function syncMetadataValueRelationships(
  meta: IMetadataRegistryRepository,
  rel: IRelationRepository,
  typeRecord: MetadataTypeRecord,
  subjectValueCode: string,
  relationshipsSent: boolean,
  targetCodesIfSent: string[] | undefined,
  actor?: string,
): Promise<void> {
  if (!typeRecord.supportsRelations || !typeRecord.relationType || !typeRecord.targetMetadataTypeCode) {
    if (relationshipsSent && targetCodesIfSent?.length) {
      throw new ValidationError('This metadata type does not support relationships', [
        { field: 'relationships', message: 'Not supported' },
      ]);
    }
    return;
  }

  if (!relationshipsSent) {
    return;
  }

  const desired = targetCodesIfSent ?? [];
  const existing = await listActiveRelationsForSubjectValue(meta, rel, typeRecord, subjectValueCode);
  const existingByNeighbor = new Map<string, MetadataRelationRecord>();
  for (const e of existing) {
    const neighbor = neighborRelatedValueCode(e, typeRecord.metadataTypeCode, subjectValueCode);
    existingByNeighbor.set(neighbor, e);
  }

  const desiredSet = new Set(desired);
  for (const [neighbor, rec] of existingByNeighbor) {
    if (!desiredSet.has(neighbor)) {
      const pk = relationPartitionKey(rec.fromMetadataTypeCode, rec.fromMetadataValueCode);
      const sk = relationSortKey(
        rec.relationType,
        rec.toMetadataTypeCode,
        rec.toMetadataValueCode,
      );
      await rel.inactivateRelation(pk, sk, actor);
    }
  }

  for (const targetCode of desired) {
    const storage = resolveRelationStorageEndpoints(
      typeRecord.relationType,
      typeRecord.metadataTypeCode,
      subjectValueCode,
      typeRecord.targetMetadataTypeCode,
      targetCode,
    );
    await ensureRelation(rel, meta, { ...storage, createdBy: actor }, actor);
  }
}

export async function inactivateAllRelationsInvolvingMetadataValue(
  meta: IMetadataRegistryRepository,
  rel: IRelationRepository,
  metadataTypeCode: string,
  valueCode: string,
  actor?: string,
): Promise<void> {
  const typeRecord = await meta.getMetadataType(metadataTypeCode);
  if (!typeRecord) {
    return;
  }

  if (typeRecord.supportsRelations && typeRecord.relationType && typeRecord.targetMetadataTypeCode) {
    const rows = await listActiveRelationsForSubjectValue(meta, rel, typeRecord, valueCode);
    for (const rec of rows) {
      const pk = relationPartitionKey(rec.fromMetadataTypeCode, rec.fromMetadataValueCode);
      const sk = relationSortKey(
        rec.relationType,
        rec.toMetadataTypeCode,
        rec.toMetadataValueCode,
      );
      await rel.inactivateRelation(pk, sk, actor);
    }
  }

  for (const rt of Object.keys(RELATION_TYPE_ALLOWED_PAIRS) as RelationType[]) {
    const pairs = RELATION_TYPE_ALLOWED_PAIRS[rt];
    for (const { from, to } of pairs) {
      if (to === metadataTypeCode) {
        const candidates = await meta.listMetadataValues(from, [STATUS.ACTIVE]);
        for (const v of candidates) {
          const pk = relationPartitionKey(from, v.valueCode);
          const sk = relationSortKey(rt, metadataTypeCode, valueCode);
          const row = await rel.getRelationByKey(pk, sk);
          if (row && (row.status ?? RELATION_STATUS.ACTIVE) === RELATION_STATUS.ACTIVE) {
            await rel.inactivateRelation(pk, sk, actor);
          }
        }
      }
      if (from === metadataTypeCode) {
        const skBeginsWith = skBeginsWithForListFilter(rt, to);
        const rows = await rel.listRelationsByFrom(from, valueCode, { skBeginsWith });
        for (const row of rows) {
          if ((row.status ?? RELATION_STATUS.ACTIVE) === RELATION_STATUS.ACTIVE) {
            const pk = relationPartitionKey(row.fromMetadataTypeCode, row.fromMetadataValueCode);
            const sk = relationSortKey(row.relationType, row.toMetadataTypeCode, row.toMetadataValueCode);
            await rel.inactivateRelation(pk, sk, actor);
          }
        }
      }
    }
  }
}
