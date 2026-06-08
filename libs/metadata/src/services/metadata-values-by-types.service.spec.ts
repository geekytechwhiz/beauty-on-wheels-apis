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
          minimalValue('Country', 'IN', { label: 'India', sortOrder: 3, attributes: { region: 'APAC' } }),
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
    expect(country.values[1]).toEqual({
      valueCode: 'IN',
      label: 'India',
      status: STATUS.ACTIVE,
      isGlobal: true,
      sortOrder: 3,
      attributes: { region: 'APAC' },
    });
  });

  it('returns values: [] when a type has no active values', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('Language'));
    mockListMetadataValues.mockResolvedValue([]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');
    const result = await getMetadataValuesByTypes(['Language']);

    expect(result.items[0].values).toEqual([]);
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

  it('throws 404 listing missing codes when a requested type does not exist', async () => {
    mockGetMetadataType.mockImplementation((code: string) =>
      Promise.resolve(code === 'Country' ? minimalType('Country') : null),
    );
    mockListMetadataValues.mockResolvedValue([]);

    const { getMetadataValuesByTypes } = await import('./metadata.service.js');

    await expect(getMetadataValuesByTypes(['Country', 'Nope'])).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('Nope'),
    });
  });
});
