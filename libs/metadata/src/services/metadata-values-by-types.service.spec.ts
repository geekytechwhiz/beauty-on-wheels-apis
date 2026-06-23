import { STATUS } from '../constants';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';

function minimalType(code: string, overrides: Partial<MetadataTypeRecord> = {}): MetadataTypeRecord {
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
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

function minimalValue(
  metadataTypeCode: string,
  valueCode: string,
  overrides: Partial<MetadataValueRecord> = {},
): MetadataValueRecord {
  return {
    metadataTypeCode,
    valueCode,
    version: 1,
    label: valueCode,
    sortOrder: 0,
    status: STATUS.ACTIVE,
    isGlobal: true,
    attributes: {},
    applicability: { module: [], category: [], condition: [], country: [] },
    applSkKeys: [],
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

describe('getMetadataValuesByTypes', () => {
  const mockGetMetadataType = jest.fn();
  const mockListMetadataValues = jest.fn();
  const mockGetMetadataRepository = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    mockGetMetadataType.mockReset();
    mockListMetadataValues.mockReset();
    mockGetMetadataRepository.mockReset();
    mockGetMetadataRepository.mockResolvedValue({
      getMetadataType: mockGetMetadataType,
      listMetadataValues: mockListMetadataValues,
    } as never);
    jest.doMock('../dynamodb/dynamodb.client.js', () => ({
      getMetadataRepository: mockGetMetadataRepository,
      getRelationRepository: jest.fn(),
      getMetadataRegistryDynamoContext: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.dontMock('../dynamodb/dynamodb.client.js');
  });

  it('maps type details and active values (sorted) for each requested code', async () => {
    mockGetMetadataType.mockImplementation((code: string) =>
      Promise.resolve(
        minimalType(code, { displayName: code, multiSelectAllowed: code === 'Country', valueDataType: 'Enum' }),
      ),
    );
    mockListMetadataValues.mockImplementation((code: string) => {
      if (code === 'Country') {
        return Promise.resolve([
          minimalValue('Country', 'IN', {
            label: 'India',
            description: 'Republic of India',
            sortOrder: 3,
            attributes: { region: 'APAC' },
          }),
          minimalValue('Country', 'US', { label: 'United States', sortOrder: 1 }),
        ]);
      }
      return Promise.resolve([]);
    });

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Country', 'Language']);

    expect(mockListMetadataValues).toHaveBeenCalledWith('Country', [STATUS.ACTIVE]);
    expect(result.items).toHaveLength(2);

    const country = result.items[0];
    expect(country).toMatchObject({
      metadataType: 'Country',
      displayName: 'Country',
      multiSelectAllowed: true,
      valueDataType: 'Enum',
    });
    // sorted by sortOrder asc: US (1) then IN (3)
    expect(country.values.map((v) => v.valueCode)).toEqual(['US', 'IN']);
    expect(country.values[0].description).toBeNull();
    expect(country.values[1]).toEqual({
      valueCode: 'IN',
      label: 'India',
      description: 'Republic of India',
      status: STATUS.ACTIVE,
      isGlobal: true,
      sortOrder: 3,
      attributes: { region: 'APAC' },
      applicability: { module: [], category: [], condition: [], country: [], language: [] },
    });
  });

  it('maps applicability dimensions (defaulting language to [])', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('Country'));
    mockListMetadataValues.mockResolvedValue([
      minimalValue('Country', 'IN', {
        applicability: { module: ['RPM'], category: ['CAT_A'], condition: ['HTN'], country: ['IN'] },
      }),
    ]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Country']);

    expect(result.items[0].values[0].applicability).toEqual({
      module: ['RPM'],
      category: ['CAT_A'],
      condition: ['HTN'],
      country: ['IN'],
      language: [],
    });
  });

  it('returns values: [] when a type has no active values', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('Language'));
    mockListMetadataValues.mockResolvedValue([]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Language']);

    expect(result.items[0].values).toEqual([]);
  });

  it('returns missingMetadataTypeCodes: [] when all requested codes exist', async () => {
    mockGetMetadataType.mockImplementation((code: string) => Promise.resolve(minimalType(code)));
    mockListMetadataValues.mockResolvedValue([]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Country', 'Language']);

    expect(result.items.map((i) => i.metadataType)).toEqual(['Country', 'Language']);
    expect(result.missingMetadataTypeCodes).toEqual([]);
  });

  it('defaults missing attributes to {}', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('Country'));
    mockListMetadataValues.mockResolvedValue([
      minimalValue('Country', 'IN', { attributes: undefined as unknown as Record<string, unknown> }),
    ]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Country']);

    expect(result.items[0].values[0].attributes).toEqual({});
  });

  it('returns description null when not stored on the value', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('Country'));
    mockListMetadataValues.mockResolvedValue([minimalValue('Country', 'US')]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Country']);

    expect(result.items[0].values[0].description).toBeNull();
  });

  it('returns 200-style partial success: existing types in items, missing codes collected', async () => {
    mockGetMetadataType.mockImplementation((code: string) =>
      Promise.resolve(code === 'InvalidType' ? null : minimalType(code)),
    );
    mockListMetadataValues.mockResolvedValue([]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Country', 'Language', 'InvalidType']);

    // request order preserved for valid items
    expect(result.items.map((i) => i.metadataType)).toEqual(['Country', 'Language']);
    expect(result.items.every((i) => Array.isArray(i.values) && i.values.length === 0)).toBe(true);
    expect(result.missingMetadataTypeCodes).toEqual(['InvalidType']);
  });

  it('returns items: [] and all codes in missingMetadataTypeCodes when none exist', async () => {
    mockGetMetadataType.mockResolvedValue(null);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Nope', 'AlsoNope']);

    expect(result.items).toEqual([]);
    expect(result.missingMetadataTypeCodes).toEqual(['Nope', 'AlsoNope']);
    expect(mockListMetadataValues).not.toHaveBeenCalled();
  });
});
