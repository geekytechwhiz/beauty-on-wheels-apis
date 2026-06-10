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

/**
 * Normalizes GET related-values query params with multi-`fromValue` support.
 * Accepts `fromValue` as a single string, repeated query params (`string[]`), or
 * comma-separated values. Trims, drops empties, dedupes, and validates each code.
 */
export function normalizeRelatedValuesQueryParams(data: {
  fromType: string;
  rawFromValues: string | string[];
  relationType?: string;
  toType?: string;
}): {
  fromType: string;
  fromValues: string[];
  relationType?: string;
  toType?: string;
} {
  const ft = data.fromType.trim();
  if (!ft) {
    throw new ValidationError('fromType and fromValue are required', [
      { field: 'fromType', message: 'Required' },
    ]);
  }
  assertMetadataTypeCode(ft, 'fromType');

  const rawList = Array.isArray(data.rawFromValues) ? data.rawFromValues : [data.rawFromValues];
  const fromValues: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawList) {
    if (typeof raw !== 'string') {
      continue;
    }
    for (const part of raw.split(',')) {
      const fv = part.trim();
      if (!fv) {
        continue;
      }
      assertMetadataValueCode(fv, 'fromValue');
      if (!seen.has(fv)) {
        seen.add(fv);
        fromValues.push(fv);
      }
    }
  }

  if (fromValues.length === 0) {
    throw new ValidationError('fromType and fromValue are required', [
      { field: 'fromValue', message: 'Required' },
    ]);
  }

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
    fromValues,
    relationType: rt || undefined,
    toType: tt || undefined,
  };
}
