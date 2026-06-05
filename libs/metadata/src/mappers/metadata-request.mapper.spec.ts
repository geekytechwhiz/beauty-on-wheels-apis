import { STATUS } from '../constants';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';
import { mergeMetadataTypeForUpdate, normalizeMetadataTypeInput, normalizeMetadataValueInput } from './metadata-request.mapper';

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
    supportsRelations: false,
    relationFieldLabel: null,
    targetMetadataTypeCode: null,
    selectionMode: null,
    relationRequired: null,
    relationType: null,
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

describe('normalizeMetadataValueInput (label)', () => {
  const existing: MetadataValueRecord = {
    metadataTypeCode: 'T',
    valueCode: 'V1',
    version: 2,
    label: 'Stored label',
    sortOrder: 0,
    status: STATUS.ACTIVE,
    isGlobal: true,
    attributes: {},
    applicability: { module: [], category: [], condition: [], country: [] },
    applSkKeys: [],
    createdAt: 'c',
    lastModifiedAt: 'm',
  };

  it('preserves label when the label key is omitted (update)', () => {
    const n = normalizeMetadataValueInput(
      {
        valueCode: 'V1',
        metadataValueCode: 'V1',
        status: STATUS.INACTIVE,
      } as never,
      existing,
    );
    expect(n.label).toBe('Stored label');
  });

  it('passes through explicit empty label for validation to reject (update)', () => {
    const n = normalizeMetadataValueInput(
      {
        valueCode: 'V1',
        label: '',
        status: STATUS.ACTIVE,
      } as never,
      existing,
    );
    expect(n.label).toBe('');
  });

  it('passes through explicit null label for validation to reject (update)', () => {
    const n = normalizeMetadataValueInput(
      {
        valueCode: 'V1',
        label: null,
        status: STATUS.ACTIVE,
      } as never,
      existing,
    );
    expect(n.label).toBe(null);
  });
});
