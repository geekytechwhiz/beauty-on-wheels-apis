import { STATUS } from '../constants';
import { ValidationError } from '../domain/errors';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';
import type { CreateMetadataRelationInput } from '../models/relation-types';
import type { IMetadataRegistryRepository } from '../repositories/metadata-registry.repository.interface';
import {
  assertGovernedRelationTypeForTypes,
  assertRelationEndpointsExist,
  assertValidRelationType,
  buildInvalidRelationMappingMessage,
  isGovernedMetadataTypeRelationMappingAllowed,
  isStrictGovernedMetadataTypeRelationConfigAllowed,
  RELATION_TYPE_ALLOWED_PAIRS,
  validateRelationPairing,
} from './relation';

describe('relation validator', () => {
  it('rejects bad relationType', () => {
    expect(() => assertValidRelationType('UNKNOWN')).toThrow();
  });

  it('validates known Country → State as PARENT_CHILD', () => {
    expect(
      () =>
        validateRelationPairing({
          relationType: 'PARENT_CHILD',
          fromMetadataTypeCode: 'Country',
          fromMetadataValueCode: 'INDIA',
          toMetadataTypeCode: 'State',
          toMetadataValueCode: 'KARNATAKA',
        }),
    ).not.toThrow();
  });

  it('validates Category → Condition as BELONGS_TO_CATEGORY (canonical storage / POST relation)', () => {
    expect(() =>
      validateRelationPairing({
        relationType: 'BELONGS_TO_CATEGORY',
        fromMetadataTypeCode: 'Category',
        fromMetadataValueCode: 'RESP',
        toMetadataTypeCode: 'Condition',
        toMetadataValueCode: 'ASTHMA',
      }),
    ).not.toThrow();
  });

  it('rejects Condition → Category as BELONGS_TO_CATEGORY on direct relation POST', () => {
    expect(() =>
      validateRelationPairing({
        relationType: 'BELONGS_TO_CATEGORY',
        fromMetadataTypeCode: 'Condition',
        fromMetadataValueCode: 'ASTHMA',
        toMetadataTypeCode: 'Category',
        toMetadataValueCode: 'RESP',
      }),
    ).toThrow(
      'Invalid relation mapping. Condition cannot relate to Category using BELONGS_TO_CATEGORY. Allowed relation mapping is Category -> Condition.',
    );
  });

  it('rejects disallowed type pair for relationType', () => {
    expect(() =>
      validateRelationPairing({
        relationType: 'PARENT_CHILD',
        fromMetadataTypeCode: 'Device',
        fromMetadataValueCode: 'A',
        toMetadataTypeCode: 'Vital',
        toMetadataValueCode: 'B',
      }),
    ).toThrow(
      'Invalid relation mapping. Device cannot relate to Vital using PARENT_CHILD. Allowed mappings for PARENT_CHILD are: Country -> State; State -> City.',
    );
  });

  it('exposes an allow list per type', () => {
    expect(RELATION_TYPE_ALLOWED_PAIRS.SUPPORTED_BY[0]).toEqual({ from: 'Device', to: 'Vital' });
  });
});

function minimalType(code: string): MetadataTypeRecord {
  return {
    metadataTypeCode: code,
    version: 1,
    displayName: code,
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    applicableModules: [],
    supportsRelations: false,
    relationFieldLabel: null,
    targetMetadataTypeCode: null,
    selectionMode: null,
    relationRequired: null,
    relationType: null,
    status: STATUS.ACTIVE,
    createdAt: 'a',
    lastModifiedAt: 'a',
  };
}

function minimalValue(
  metadataTypeCode: string,
  valueCode: string,
  status: (typeof STATUS)[keyof typeof STATUS],
): MetadataValueRecord {
  return {
    metadataTypeCode,
    valueCode,
    version: 1,
    label: valueCode,
    sortOrder: 0,
    status,
    isGlobal: true,
    attributes: {},
    applicability: { module: [], category: [], condition: [], country: [] },
    applSkKeys: [],
    createdAt: 'a',
    lastModifiedAt: 'a',
  };
}

const relationInput = (): CreateMetadataRelationInput => ({
  relationType: 'PARENT_CHILD',
  fromMetadataTypeCode: 'Country',
  fromMetadataValueCode: 'US',
  toMetadataTypeCode: 'State',
  toMetadataValueCode: 'CA',
});

function mockRelationRepo(fromVal: MetadataValueRecord, toVal: MetadataValueRecord): IMetadataRegistryRepository {
  const input = relationInput();
  return {
    getMetadataType: jest.fn(async (code: string) => minimalType(code)),
    getMetadataValue: jest.fn(async (type: string, code: string) => {
      if (type === input.fromMetadataTypeCode && code === input.fromMetadataValueCode) {
        return fromVal;
      }
      if (type === input.toMetadataTypeCode && code === input.toMetadataValueCode) {
        return toVal;
      }
      return null;
    }),
  } as unknown as IMetadataRegistryRepository;
}

describe('assertRelationEndpointsExist (value lifecycle)', () => {
  it('allows relation when both endpoint values are ACTIVE', async () => {
    const repo = mockRelationRepo(
      minimalValue('Country', 'US', STATUS.ACTIVE),
      minimalValue('State', 'CA', STATUS.ACTIVE),
    );
    await expect(assertRelationEndpointsExist(repo, relationInput())).resolves.toBeUndefined();
  });

  it('rejects when from value is DELETED', async () => {
    const repo = mockRelationRepo(
      minimalValue('Country', 'US', STATUS.DELETED),
      minimalValue('State', 'CA', STATUS.ACTIVE),
    );
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toMatchObject({
      details: [{ field: 'fromMetadataValueCode' }],
    });
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toThrow(
      /Metadata value US is DELETED and cannot be used in relations/,
    );
  });

  it('rejects when to value is DELETED', async () => {
    const repo = mockRelationRepo(
      minimalValue('Country', 'US', STATUS.ACTIVE),
      minimalValue('State', 'CA', STATUS.DELETED),
    );
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toMatchObject({
      details: [{ field: 'toMetadataValueCode' }],
    });
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toThrow(
      /Metadata value CA is DELETED and cannot be used in relations/,
    );
  });

  it('rejects when both values are DELETED', async () => {
    const repo = mockRelationRepo(
      minimalValue('Country', 'US', STATUS.DELETED),
      minimalValue('State', 'CA', STATUS.DELETED),
    );
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toMatchObject({
      details: [{ field: 'fromMetadataValueCode' }],
    });
  });

  it('rejects when from value is INACTIVE', async () => {
    const repo = mockRelationRepo(
      minimalValue('Country', 'US', STATUS.INACTIVE),
      minimalValue('State', 'CA', STATUS.ACTIVE),
    );
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toThrow(
      /Metadata value US is INACTIVE and cannot be used in active relations/,
    );
  });

  it('rejects when to value is INACTIVE', async () => {
    const repo = mockRelationRepo(
      minimalValue('Country', 'US', STATUS.ACTIVE),
      minimalValue('State', 'CA', STATUS.INACTIVE),
    );
    await expect(assertRelationEndpointsExist(repo, relationInput())).rejects.toThrow(
      /Metadata value CA is INACTIVE and cannot be used in active relations/,
    );
  });
});

/** Unordered pair check (storage / orientation); still bidirectional where the matrix supports it. */
describe('isGovernedMetadataTypeRelationMappingAllowed (orchestration / storage pairing)', () => {
  it('PARENT_CHILD no longer governs Condition ↔ Category; use BELONGS_TO_CATEGORY (Category → Condition storage)', () => {
    expect(isGovernedMetadataTypeRelationMappingAllowed('PARENT_CHILD', 'Condition', 'Category')).toBe(false);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('PARENT_CHILD', 'Condition', 'Category')).toBe(false);
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'PARENT_CHILD',
        metadataTypeCode: 'Condition',
        targetMetadataTypeCode: 'Category',
      }),
    ).toThrow(
      'Invalid relation mapping. Condition cannot relate to Category using PARENT_CHILD. Allowed mappings — BELONGS_TO_CATEGORY: Condition -> Category.',
    );
  });

  it('treats State ↔ Country as an allowed PARENT_CHILD pair for orientation', () => {
    expect(isGovernedMetadataTypeRelationMappingAllowed('PARENT_CHILD', 'State', 'Country')).toBe(true);
    expect(isGovernedMetadataTypeRelationMappingAllowed('PARENT_CHILD', 'Country', 'State')).toBe(true);
  });

  it('treats City ↔ State as an allowed PARENT_CHILD pair when State–City edge exists', () => {
    expect(isGovernedMetadataTypeRelationMappingAllowed('PARENT_CHILD', 'City', 'State')).toBe(true);
    expect(isGovernedMetadataTypeRelationMappingAllowed('PARENT_CHILD', 'State', 'City')).toBe(true);
  });
});

/** Metadata type row: strict business direction only. */
describe('isStrictGovernedMetadataTypeRelationConfigAllowed / assertGovernedRelationTypeForTypes', () => {
  it('PARENT_CHILD: allows State → Country and City → State; rejects parent→child type rows', () => {
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('PARENT_CHILD', 'State', 'Country')).toBe(true);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('PARENT_CHILD', 'City', 'State')).toBe(true);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('PARENT_CHILD', 'Country', 'State')).toBe(false);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('PARENT_CHILD', 'State', 'City')).toBe(false);
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'PARENT_CHILD',
        metadataTypeCode: 'State',
        targetMetadataTypeCode: 'Country',
      }),
    ).not.toThrow();
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'PARENT_CHILD',
        metadataTypeCode: 'Country',
        targetMetadataTypeCode: 'State',
      }),
    ).toThrow(ValidationError);
    expect(
      buildInvalidRelationMappingMessage('PARENT_CHILD', 'Country', 'State'),
    ).toBe(
      'Invalid relation mapping. Country cannot relate to State using PARENT_CHILD. Allowed direction is State -> Country.',
    );
  });

  it('SUPPORTED_BY: allows Device → Vital only', () => {
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('SUPPORTED_BY', 'Device', 'Vital')).toBe(true);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('SUPPORTED_BY', 'Vital', 'Device')).toBe(false);
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'SUPPORTED_BY',
        metadataTypeCode: 'Device',
        targetMetadataTypeCode: 'Vital',
      }),
    ).not.toThrow();
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'SUPPORTED_BY',
        metadataTypeCode: 'Vital',
        targetMetadataTypeCode: 'Device',
      }),
    ).toThrow(
      'Invalid relation mapping. Vital cannot relate to Device using SUPPORTED_BY. Allowed direction is Device -> Vital.',
    );
  });

  it('BELONGS_TO_CATEGORY: allows metadata type rows Condition → Category and Category → Condition (governed pair)', () => {
    expect(
      isStrictGovernedMetadataTypeRelationConfigAllowed('BELONGS_TO_CATEGORY', 'Condition', 'Category'),
    ).toBe(true);
    expect(
      isStrictGovernedMetadataTypeRelationConfigAllowed('BELONGS_TO_CATEGORY', 'Category', 'Condition'),
    ).toBe(true);
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'BELONGS_TO_CATEGORY',
        metadataTypeCode: 'Category',
        targetMetadataTypeCode: 'Condition',
      }),
    ).not.toThrow();
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'BELONGS_TO_CATEGORY',
        metadataTypeCode: 'Condition',
        targetMetadataTypeCode: 'Category',
      }),
    ).not.toThrow();
  });

  it('BELONGS_TO_CATEGORY: rejects unrelated type pairs', () => {
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'BELONGS_TO_CATEGORY',
        metadataTypeCode: 'Device',
        targetMetadataTypeCode: 'Vital',
      }),
    ).toThrow(ValidationError);
  });

  it('VALID_IN: allows Currency → Country only for metadata type config; rejects Country → Currency', () => {
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('VALID_IN', 'Currency', 'Country')).toBe(true);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('VALID_IN', 'Country', 'Currency')).toBe(false);
    expect(isGovernedMetadataTypeRelationMappingAllowed('VALID_IN', 'Country', 'Currency')).toBe(true);
    expect(isGovernedMetadataTypeRelationMappingAllowed('VALID_IN', 'Currency', 'Country')).toBe(true);
    expect(isStrictGovernedMetadataTypeRelationConfigAllowed('VALID_IN', 'Currency', 'City')).toBe(false);
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'VALID_IN',
        metadataTypeCode: 'Country',
        targetMetadataTypeCode: 'Currency',
      }),
    ).toThrow(
      'Invalid relation mapping. Country cannot relate to Currency using VALID_IN. Allowed direction is Currency -> Country.',
    );
  });

  it('VALID_IN: validateRelationPairing accepts only canonical storage direction', () => {
    expect(() =>
      validateRelationPairing({
        relationType: 'VALID_IN',
        fromMetadataTypeCode: 'Currency',
        fromMetadataValueCode: 'USD',
        toMetadataTypeCode: 'Country',
        toMetadataValueCode: 'US',
      }),
    ).not.toThrow();
    expect(() =>
      validateRelationPairing({
        relationType: 'VALID_IN',
        fromMetadataTypeCode: 'Country',
        fromMetadataValueCode: 'US',
        toMetadataTypeCode: 'Currency',
        toMetadataValueCode: 'USD',
      }),
    ).toThrow(
      'Invalid relation mapping. Country cannot relate to Currency using VALID_IN. Allowed relation mapping is Currency -> Country.',
    );
  });

  it('rejects Device → Country using SUPPORTED_BY with allowed target hint', () => {
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'SUPPORTED_BY',
        metadataTypeCode: 'Device',
        targetMetadataTypeCode: 'Country',
      }),
    ).toThrow(
      'Invalid relation mapping. Device cannot relate to Country using SUPPORTED_BY. Allowed target metadata type is Vital.',
    );
  });

  it('rejects State → Vital using PARENT_CHILD with allowed target hint', () => {
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'PARENT_CHILD',
        metadataTypeCode: 'State',
        targetMetadataTypeCode: 'Vital',
      }),
    ).toThrow(
      'Invalid relation mapping. State cannot relate to Vital using PARENT_CHILD. Allowed target metadata type is Country.',
    );
  });

  it('rejects Device → Country using VALID_IN with catalog mapping list', () => {
    expect(() =>
      assertGovernedRelationTypeForTypes({
        relationType: 'VALID_IN',
        metadataTypeCode: 'Device',
        targetMetadataTypeCode: 'Country',
      }),
    ).toThrow(
      'Invalid relation mapping. Device cannot relate to Country using VALID_IN. Allowed mappings for VALID_IN are: Currency -> Country.',
    );
  });
});
