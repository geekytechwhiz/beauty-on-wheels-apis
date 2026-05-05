import { describe, expect, it } from '@jest/globals';
import { STATUS } from '../constants';
import { ValidationError } from '../domain/errors';
import type { MetadataTypeRecord } from '../models/types';
import { validateMetadataTypeInput, validateMetadataValueConditionalApplicability } from './validate-inputs';

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

  it('accepts metadataTypeCode containing underscore after leading capital', () => {
    expect(() =>
      validateMetadataTypeInput({ ...validCreate, metadataTypeCode: 'Sample_Type' }, false),
    ).not.toThrow();
  });

  it('accepts create without applicableModules (optional)', () => {
    const { applicableModules: _a, ...rest } = validCreate;
    expect(() => validateMetadataTypeInput(rest as typeof validCreate, false)).not.toThrow();
  });

  it('accepts create with empty applicableModules', () => {
    expect(() => validateMetadataTypeInput({ ...validCreate, applicableModules: [] }, false)).not.toThrow();
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

  it('allows update with empty applicableModules (no module restriction)', () => {
    expect(() =>
      validateMetadataTypeInput(
        {
          metadataTypeCode: 'Country',
          displayName: 'Country',
          applicableModules: [],
        },
        true,
      ),
    ).not.toThrow();
  });

  it('rejects non-string metadataTypeCode', () => {
    try {
      validateMetadataTypeInput({ ...validCreate, metadataTypeCode: 123 as never }, false);
      expect.fail('expected ValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details?.[0]?.message).toBe('Must be a string');
    }
  });
});

describe('validateMetadataValueConditionalApplicability', () => {
  const type: MetadataTypeRecord = {
    metadataTypeCode: 'T',
    version: 1,
    displayName: 'T',
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    applicableModules: ['M'],
    status: STATUS.ACTIVE,
    createdAt: '',
    lastModifiedAt: '',
  };

  it('requires applicableLanguages when languageDependent is set', () => {
    expect(() =>
      validateMetadataValueConditionalApplicability(
        { ...type, valueApplicabilityConfig: { languageDependent: true } },
        false,
        { module: ['M'], category: [], condition: [], country: [], language: [] },
      ),
    ).toThrow(/applicableLanguages is required/);
    expect(() =>
      validateMetadataValueConditionalApplicability(
        { ...type, valueApplicabilityConfig: { languageDependent: true } },
        false,
        { module: ['M'], category: [], condition: [], country: [], language: ['EN'] },
      ),
    ).not.toThrow();
  });
});
