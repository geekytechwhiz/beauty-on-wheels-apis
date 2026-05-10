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

  it('rejects metadataTypeCode containing underscore', () => {
    expect(() =>
      validateMetadataTypeInput({ ...validCreate, metadataTypeCode: 'Sample_Type' }, false),
    ).toThrow(ValidationError);
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

  it('rejects update without status', () => {
    expect(() =>
      validateMetadataTypeInput(
        {
          metadataTypeCode: 'SampleType',
          displayName: 'Renamed',
          valueDataType: 'Enum',
          multiSelectAllowed: false,
          applicableModules: [],
        },
        true,
      ),
    ).toThrow(/status is required on update/);
  });

  it('rejects update with invalid status', () => {
    expect(() =>
      validateMetadataTypeInput(
        {
          metadataTypeCode: 'SampleType',
          displayName: 'Renamed',
          valueDataType: 'Enum',
          multiSelectAllowed: false,
          applicableModules: [],
          status: 'DRAFT' as never,
        },
        true,
      ),
    ).toThrow(/status must be ACTIVE or INACTIVE/);
  });

  it('allows update with empty applicableModules (no module restriction) when status is provided', () => {
    expect(() =>
      validateMetadataTypeInput(
        {
          metadataTypeCode: 'Country',
          displayName: 'Country',
          valueDataType: 'Enum',
          multiSelectAllowed: false,
          applicableModules: [],
          status: 'ACTIVE',
        },
        true,
      ),
    ).not.toThrow();
  });

  it('rejects merged update snapshot with null displayName', () => {
    expect(() =>
      validateMetadataTypeInput(
        {
          metadataTypeCode: 'SampleType',
          displayName: null as never,
          valueDataType: 'Enum',
          multiSelectAllowed: false,
          applicableModules: [],
          status: 'ACTIVE',
        },
        true,
      ),
    ).toThrow(/displayName is required on update/);
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
