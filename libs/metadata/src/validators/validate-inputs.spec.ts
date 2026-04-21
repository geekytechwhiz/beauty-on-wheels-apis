import { describe, expect, it } from '@jest/globals';
import { validateMetadataTypeInput } from './validate-inputs';

describe('validateMetadataTypeInput', () => {
  const validCreate = {
    metadataTypeCode: 'SampleType',
    displayName: 'Sample',
    valueDataType: 'Enum' as const,
    multiSelectAllowed: false,
    applicableModules: ['PROVIDER'],
    status: 'ACTIVE' as const,
  };

  it('accepts a complete create payload', () => {
    expect(() => validateMetadataTypeInput(validCreate, false)).not.toThrow();
  });

  it('rejects create without status', () => {
    const { status: _s, ...rest } = validCreate;
    expect(() => validateMetadataTypeInput(rest as typeof validCreate, false)).toThrow(/status is required on create/);
  });

  it('rejects create with invalid status', () => {
    expect(() =>
      validateMetadataTypeInput({ ...validCreate, status: 'DRAFT' as never }, false),
    ).toThrow(/status must be ACTIVE or INACTIVE/);
  });

  it('allows partial update without status', () => {
    expect(() =>
      validateMetadataTypeInput({ metadataTypeCode: 'SampleType', displayName: 'Renamed' }, true),
    ).not.toThrow();
  });
});
