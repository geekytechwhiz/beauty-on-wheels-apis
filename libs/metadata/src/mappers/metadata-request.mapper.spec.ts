import { describe, expect, it } from '@jest/globals';

import { STATUS } from '../constants';
import type { MetadataTypeRecord } from '../models/types';
import { mergeMetadataTypeForUpdate, normalizeMetadataTypeInput } from './metadata-request.mapper';

describe('normalizeMetadataTypeInput (partial keys)', () => {
  it('does not add undefined keys for omitted body fields', () => {
    const normalized = normalizeMetadataTypeInput({
      metadataTypeCode: 'SampleType',
      status: STATUS.ACTIVE,
    } as never);
    expect(Object.keys(normalized).sort()).toEqual(['metadataTypeCode', 'status'].sort());
  });
});

describe('mergeMetadataTypeForUpdate', () => {
  const existing: MetadataTypeRecord = {
    metadataTypeCode: 'SampleType',
    version: 1,
    displayName: 'Sample',
    description: 'd',
    valueDataType: 'Enum',
    multiSelectAllowed: true,
    applicableModules: ['PROVIDER'],
    attributeSchema: { attributes: [{ name: 'a' }] },
    status: STATUS.ACTIVE,
    createdAt: 'c',
    lastModifiedAt: 'm',
    createdBy: 'u1',
    lastModifiedBy: 'u1',
  };

  it('preserves persisted fields when the patch only sends code + status (scenario A/E)', () => {
    const patch = normalizeMetadataTypeInput({
      metadataTypeCode: 'SampleType',
      status: STATUS.ACTIVE,
    } as never);
    const merged = mergeMetadataTypeForUpdate(existing, patch);
    expect(merged.displayName).toBe('Sample');
    expect(merged.valueDataType).toBe('Enum');
    expect(merged.multiSelectAllowed).toBe(true);
    expect(merged.applicableModules).toEqual(['PROVIDER']);
    expect(merged.attributeSchema).toEqual(existing.attributeSchema);
    expect(merged.status).toBe(STATUS.ACTIVE);
  });

  it('preserves attributeSchema when omitted from the patch (scenario D)', () => {
    const patch = normalizeMetadataTypeInput({
      metadataTypeCode: 'SampleType',
      status: STATUS.INACTIVE,
    } as never);
    const merged = mergeMetadataTypeForUpdate(existing, patch);
    expect(merged.attributeSchema).toEqual({ attributes: [{ name: 'a' }] });
  });
});
