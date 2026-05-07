import {
  ValidationError,
  assertMetadataTypeCode,
  assertMetadataValueCode,
  assertValidRelationType,
} from '@api-hub/metadata';

/** Normalizes and validates GET relation list query params (shared by relations + related-values routes). */
export function normalizeRelationListQueryParams(data: {
  fromType: string;
  fromValue: string;
  relationType?: string;
  toType?: string;
}): {
  fromType: string;
  fromValue: string;
  relationType?: string;
  toType?: string;
} {
  const ft = data.fromType.trim();
  const fv = data.fromValue.trim();
  if (!ft || !fv) {
    throw new ValidationError('fromType and fromValue are required', [
      { field: 'fromType', message: 'Required' },
      { field: 'fromValue', message: 'Required' },
    ]);
  }
  assertMetadataTypeCode(ft, 'fromType');
  assertMetadataValueCode(fv, 'fromValue');
  const rt = data.relationType?.trim();
  if (rt) {
    assertValidRelationType(rt);
  }
  const tt = data.toType?.trim();
  if (tt) {
    assertMetadataTypeCode(tt, 'toType');
  }
  return {
    fromType: ft,
    fromValue: fv,
    relationType: rt || undefined,
    toType: tt || undefined,
  };
}
