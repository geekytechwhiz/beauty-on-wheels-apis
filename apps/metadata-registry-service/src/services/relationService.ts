import {
  type MetadataRelationRecord,
  type RelatedValueRef,
  type RelationStatus,
  NotFoundError,
  RELATION_STATUS,
  skBeginsWithForListFilter,
  assertRelationEndpointsExist,
  getMetadataRepository,
  getRelationRepository,
} from '@api-hub/metadata';

/** A related value enriched with its metadata label (when available). */
export interface RelatedValueRefWithLabel extends RelatedValueRef {
  label?: string;
}

/** Related values grouped by their source (`fromValue`), with the source label. */
export interface RelatedValuesGroup {
  fromMetadataTypeCode: string;
  fromMetadataValueCode: string;
  fromLabel?: string;
  values: RelatedValueRefWithLabel[];
}

export async function listRelationsForValue(
  fromType: string,
  fromValue: string,
  query: { relationType?: string; toType?: string },
): Promise<MetadataRelationRecord[]> {
  const skBeginsWith = skBeginsWithForListFilter(query.relationType, query.toType);
  const rel = await getRelationRepository();
  let rows = await rel.listRelationsByFrom(fromType, fromValue, { skBeginsWith });
  if (query.toType && !query.relationType) {
    const t = query.toType;
    rows = rows.filter((r: MetadataRelationRecord) => r.toMetadataTypeCode === t);
  }
  return rows;
}

export async function listRelatedValues(
  fromType: string,
  fromValue: string,
  query: { relationType?: string; toType?: string },
): Promise<RelatedValueRef[]> {
  const rows = await listRelationsForValue(fromType, fromValue, query);
  return rows.map((r) => ({
    metadataTypeCode: r.toMetadataTypeCode,
    metadataValueCode: r.toMetadataValueCode,
  }));
}

/**
 * Returns related values grouped by source `fromValue`. For each source value it
 * queries relations independently, dedupes related values by
 * `metadataTypeCode + metadataValueCode`, and attaches labels (`fromLabel` for the
 * source, `label` per related value) resolved from the metadata registry.
 * Results are never merged across source values — one group per `fromValue`.
 */
export async function listRelatedValuesGrouped(
  fromType: string,
  fromValues: string[],
  query: { relationType?: string; toType?: string },
): Promise<RelatedValuesGroup[]> {
  const meta = await getMetadataRepository();
  const labelCache = new Map<string, string | undefined>();

  const resolveLabel = async (typeCode: string, valueCode: string): Promise<string | undefined> => {
    const cacheKey = `${typeCode}#${valueCode}`;
    if (labelCache.has(cacheKey)) {
      return labelCache.get(cacheKey);
    }
    const record = await meta.getMetadataValue(typeCode, valueCode);
    const label = record?.label;
    labelCache.set(cacheKey, label);
    return label;
  };

  const groups: RelatedValuesGroup[] = [];
  for (const fromValue of fromValues) {
    const rows = await listRelationsForValue(fromType, fromValue, query);

    const seen = new Set<string>();
    const values: RelatedValueRefWithLabel[] = [];
    for (const r of rows) {
      const dedupeKey = `${r.toMetadataTypeCode}#${r.toMetadataValueCode}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      const label = await resolveLabel(r.toMetadataTypeCode, r.toMetadataValueCode);
      values.push({
        metadataTypeCode: r.toMetadataTypeCode,
        metadataValueCode: r.toMetadataValueCode,
        ...(label !== undefined ? { label } : {}),
      });
    }

    const fromLabel = await resolveLabel(fromType, fromValue);
    groups.push({
      fromMetadataTypeCode: fromType,
      fromMetadataValueCode: fromValue,
      ...(fromLabel !== undefined ? { fromLabel } : {}),
      values,
    });
  }

  return groups;
}

export async function updateRelationStatusById(
  pk: string,
  sk: string,
  status: RelationStatus,
  userId?: string,
): Promise<MetadataRelationRecord> {
  const rel = await getRelationRepository();
  if (status === RELATION_STATUS.ACTIVE) {
    const existing = await rel.getRelationByKey(pk, sk);
    if (!existing) {
      throw new NotFoundError('Relation not found');
    }
    const meta = await getMetadataRepository();
    await assertRelationEndpointsExist(meta, {
      relationType: existing.relationType,
      fromMetadataTypeCode: existing.fromMetadataTypeCode,
      fromMetadataValueCode: existing.fromMetadataValueCode,
      toMetadataTypeCode: existing.toMetadataTypeCode,
      toMetadataValueCode: existing.toMetadataValueCode,
    });
  }
  return rel.updateRelationStatus(pk, sk, status, userId);
}
