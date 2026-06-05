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
