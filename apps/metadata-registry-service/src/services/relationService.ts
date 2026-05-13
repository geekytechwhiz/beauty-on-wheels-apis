import {
  type CreateMetadataRelationInput,
  type MetadataRelationRecord,
  type RelatedValueRef,
  skBeginsWithForListFilter,
  assertRelationEndpointsExist,
  getMetadataRepository,
  getRelationRepository,
} from '@api-hub/metadata';

export async function createMetadataRelation(
  body: CreateMetadataRelationInput,
  userId?: string,
): Promise<MetadataRelationRecord> {
  const meta = await getMetadataRepository();
  await assertRelationEndpointsExist(meta, body);
  const rel = await getRelationRepository();
  const actor = body.createdBy ?? userId;
  return rel.createRelation({ ...body, createdBy: actor }, actor);
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

export async function inactivateRelationById(
  pk: string,
  sk: string,
  userId?: string,
): Promise<MetadataRelationRecord> {
  const rel = await getRelationRepository();
  return rel.inactivateRelation(pk, sk, userId);
}
