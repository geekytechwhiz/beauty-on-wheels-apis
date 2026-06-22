import { STATUS } from '../constants';
import type { MetadataTypeInput, MetadataTypeRecord } from '../models/types';

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

function relationBody(
  metadataTypeCode: string,
  overrides: Partial<MetadataTypeInput> = {},
): MetadataTypeInput {
  return {
    metadataTypeCode,
    displayName: metadataTypeCode,
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    applicableModules: [],
    status: STATUS.ACTIVE,
    supportsRelations: true,
    relationFieldLabel: 'Rel',
    targetMetadataTypeCode: 'Vital',
    selectionMode: 'SINGLE',
    relationRequired: false,
    relationType: 'SUPPORTED_BY',
    ...overrides,
  };
}

describe('upsertMetadataType (governed relation mapping)', () => {
  const mockGetMetadataType = jest.fn();
  const mockCreateMetadataType = jest.fn();
  const mockUpdateMetadataType = jest.fn();
  const mockGetMetadataRepository = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    mockGetMetadataType.mockReset();
    mockCreateMetadataType.mockReset();
    mockUpdateMetadataType.mockReset();
    mockGetMetadataRepository.mockReset();
    mockGetMetadataRepository.mockResolvedValue({
      getMetadataType: mockGetMetadataType,
      createMetadataType: mockCreateMetadataType,
      updateMetadataType: mockUpdateMetadataType,
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

  it('rejects create before persistence when relation pair is not governed', async () => {
    mockGetMetadataType.mockImplementation((code: string) => {
      if (code === 'Device') {
        return Promise.resolve(null);
      }
      if (code === 'Country') {
        return Promise.resolve(minimalType('Country'));
      }
      return Promise.resolve(null);
    });

    const { upsertMetadataType } = await import('./metadata.service.js');

    const body = relationBody('Device', {
      targetMetadataTypeCode: 'Country',
    });

    await expect(upsertMetadataType(body)).rejects.toThrow(
      /Invalid relation mapping\. Device cannot relate to Country using SUPPORTED_BY\./,
    );
    expect(mockCreateMetadataType).not.toHaveBeenCalled();
  });

  it('allows create when pair matches RELATION_TYPE_ALLOWED_PAIRS', async () => {
    mockGetMetadataType.mockImplementation((code: string) => {
      if (code === 'Device') {
        return Promise.resolve(null);
      }
      if (code === 'Vital') {
        return Promise.resolve(minimalType('Vital'));
      }
      return Promise.resolve(null);
    });

    const created = minimalType('Device', {
      supportsRelations: true,
      relationFieldLabel: 'Rel',
      targetMetadataTypeCode: 'Vital',
      selectionMode: 'SINGLE',
      relationRequired: false,
      relationType: 'SUPPORTED_BY',
    });
    mockCreateMetadataType.mockResolvedValue(created);

    const { upsertMetadataType } = await import('./metadata.service.js');

    const body = relationBody('Device');
    await expect(upsertMetadataType(body)).resolves.toEqual(created);
    expect(mockCreateMetadataType).toHaveBeenCalledTimes(1);
  });

  it('allows ServiceType ALLOWED_FOR → Specialty type configuration', async () => {
    mockGetMetadataType.mockImplementation((code: string) => {
      if (code === 'ServiceType') {
        return Promise.resolve(null);
      }
      if (code === 'Specialty') {
        return Promise.resolve(minimalType('Specialty'));
      }
      return Promise.resolve(null);
    });

    const created = minimalType('ServiceType', {
      supportsRelations: true,
      relationFieldLabel: 'Allowed Specialties',
      targetMetadataTypeCode: 'Specialty',
      selectionMode: 'MULTI',
      relationRequired: false,
      relationType: 'ALLOWED_FOR',
    });
    mockCreateMetadataType.mockResolvedValue(created);

    const { upsertMetadataType } = await import('./metadata.service.js');

    const body = relationBody('ServiceType', {
      targetMetadataTypeCode: 'Specialty',
      relationType: 'ALLOWED_FOR',
      relationFieldLabel: 'Allowed Specialties',
      selectionMode: 'MULTI',
    });
    await expect(upsertMetadataType(body)).resolves.toEqual(created);
    expect(mockCreateMetadataType).toHaveBeenCalledTimes(1);
  });

  it('rejects update before persistence when merged relation pair is not governed', async () => {
    const existing = minimalType('Device', {
      supportsRelations: true,
      relationFieldLabel: 'Supported by',
      targetMetadataTypeCode: 'Vital',
      selectionMode: 'SINGLE',
      relationRequired: false,
      relationType: 'SUPPORTED_BY',
    });

    mockGetMetadataType.mockImplementation((code: string) => {
      if (code === 'Device') {
        return Promise.resolve(existing);
      }
      if (code === 'Country') {
        return Promise.resolve(minimalType('Country'));
      }
      return Promise.resolve(null);
    });

    const { upsertMetadataType } = await import('./metadata.service.js');

    const patch: MetadataTypeInput = {
      metadataTypeCode: 'Device',
      targetMetadataTypeCode: 'Country',
      status: STATUS.ACTIVE,
    };

    await expect(upsertMetadataType(patch)).rejects.toThrow(
      /Invalid relation mapping\. Device cannot relate to Country using SUPPORTED_BY\./,
    );
    expect(mockUpdateMetadataType).not.toHaveBeenCalled();
  });
});
