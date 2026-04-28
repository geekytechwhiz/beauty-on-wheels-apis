import {
  decodeRelationId,
  type CreateMetadataRelationInput,
  type MetadataRelationRecord,
  type RelatedValueRef,
  ValidationError,
  assertMetadataTypeCode,
  assertMetadataValueCode,
  assertValidRelationType,
  skBeginsWithForListFilter,
  validateRelationRequestShape,
  assertRelationEndpointsExist,
} from '@api-hub/metadata';
import { getMetadataRepository, getRelationRepository } from '../repositories/dynamodb';

export async function createMetadataRelation(
  body: CreateMetadataRelationInput,
  userId?: string,
): Promise<MetadataRelationRecord> {
  validateRelationRequestShape(body);
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
  if (!fromType?.trim() || !fromValue?.trim()) {
    throw new ValidationError('fromType and fromValue are required', [
      { field: 'fromType', message: 'Required' },
      { field: 'fromValue', message: 'Required' },
    ]);
  }
  assertMetadataTypeCode(fromType, 'fromType');
  assertMetadataValueCode(fromValue, 'fromValue');
  if (query.relationType?.trim()) {
    assertValidRelationType(query.relationType.trim());
  }
  if (query.toType?.trim()) {
    assertMetadataTypeCode(query.toType.trim(), 'toType');
  }
  const skBeginsWith = skBeginsWithForListFilter(
    query.relationType?.trim(),
    query.toType?.trim(),
  );
  const rel = await getRelationRepository();
  let rows = await rel.listRelationsByFrom(fromType, fromValue, { skBeginsWith });
  if (query.toType?.trim() && !query.relationType?.trim()) {
    const t = query.toType.trim();
    rows = rows.filter((r) => r.toMetadataTypeCode === t);
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
  id: string,
  userId?: string,
): Promise<MetadataRelationRecord> {
  let pk: string;
  let sk: string;
  try {
    ({ pk, sk } = decodeRelationId(id));
  } catch {
    throw new ValidationError('Invalid relation id', [{ field: 'id', message: 'Invalid' }]);
  }
  const rel = await getRelationRepository();
  return rel.inactivateRelation(pk, sk, userId);
}
