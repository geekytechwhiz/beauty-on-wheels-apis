import { STATUS } from '../constants';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
} from '../models/change-request.types';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';

const mockSaveChangeRequestDraft = jest.fn();
const mockGetMetadataType = jest.fn();
const mockGetMetadataValue = jest.fn();
const mockListMetadataValues = jest.fn();
const mockGetMetadataRepository = jest.fn();

jest.mock('../dynamodb/dynamodb.client', () => ({
  getMetadataRepository: () => mockGetMetadataRepository(),
  getRelationRepository: jest.fn(),
  getMetadataRegistryDynamoContext: jest.fn(),
}));

import { orchestrateRegistryPostDraft } from './metadata-change-request.service';

function minimalType(code: string, overrides: Partial<MetadataTypeRecord> = {}): MetadataTypeRecord {
  return {
    metadataTypeCode: code,
    version: 2,
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
    version: 3,
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

describe('orchestrateRegistryPostDraft', () => {
  beforeEach(() => {
    mockSaveChangeRequestDraft.mockReset();
    mockGetMetadataType.mockReset();
    mockGetMetadataValue.mockReset();
    mockListMetadataValues.mockReset();
    mockGetMetadataRepository.mockReset();
    mockGetMetadataRepository.mockResolvedValue({
      getMetadataType: mockGetMetadataType,
      getMetadataValue: mockGetMetadataValue,
      listMetadataValues: mockListMetadataValues,
      saveChangeRequestDraft: mockSaveChangeRequestDraft,
    });
    mockSaveChangeRequestDraft.mockImplementation(async (record: unknown) => record);
  });

  it('saves value Add draft with baseVersion null and does not publish', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('MetricCode'));
    mockGetMetadataValue.mockResolvedValue(null);

    const result = await orchestrateRegistryPostDraft({
      entityType: 'value',
      userId: 'admin',
      action: 'draft',
      body: {
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'HEART_RATE',
        label: 'Heart Rate',
        status: 'ACTIVE',
        isGlobal: true,
        valueAttributes: { dataType: 'Numeric', unit: 'bpm' },
        applicableModules: [],
        applicableCategories: [],
        applicableConditions: [],
        applicableCountries: [],
        applicableLanguages: [],
      },
    });

    expect(result.status).toBe(CHANGE_REQUEST_STATUS.DRAFT);
    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.ADD);
    expect(result.baseVersion).toBeNull();
    expect(result.metadataValueCode).toBe('HEART_RATE');
    expect(result.changeRequestId).toEqual(expect.any(String));
    expect(mockSaveChangeRequestDraft).toHaveBeenCalledTimes(1);
    const saved = mockSaveChangeRequestDraft.mock.calls[0][0];
    expect(saved.proposedPayload.metadataValueCode).toBe('HEART_RATE');
  });

  it('saves value Update draft with latest baseVersion', async () => {
    mockGetMetadataType.mockResolvedValue(minimalType('MetricCode'));
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));

    const result = await orchestrateRegistryPostDraft({
      entityType: 'value',
      userId: 'admin',
      action: 'draft',
      body: {
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'BP_SYSTOLIC',
        label: 'BP Systolic',
        status: 'ACTIVE',
        isGlobal: true,
        valueAttributes: { dataType: 'Numeric', unit: 'kPa' },
        applicableModules: [],
        applicableCategories: [],
        applicableConditions: [],
        applicableCountries: [],
        applicableLanguages: [],
      },
    });

    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
    expect(result.baseVersion).toBe(3);
    expect(mockSaveChangeRequestDraft).toHaveBeenCalledTimes(1);
  });

  it('saves type Update draft with baseVersion from published type', async () => {
    mockGetMetadataType.mockResolvedValue(
      minimalType('CustomType', {
        displayName: 'Custom',
        valueDataType: 'Text',
        multiSelectAllowed: true,
        applicableModules: ['OKR'],
      }),
    );

    const result = await orchestrateRegistryPostDraft({
      entityType: 'type',
      userId: 'admin',
      action: 'draft',
      body: {
        metadataTypeCode: 'CustomType',
        displayName: 'Custom Updated',
        valueDataType: 'Text',
        multiSelectAllowed: true,
        applicableModules: ['OKR'],
        status: 'ACTIVE',
      },
    });

    expect(result.entityType).toBe('type');
    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
    expect(result.baseVersion).toBe(2);
    expect(mockSaveChangeRequestDraft).toHaveBeenCalledTimes(1);
  });

  it('saves type Add draft when type does not exist', async () => {
    mockGetMetadataType.mockResolvedValue(null);

    const result = await orchestrateRegistryPostDraft({
      entityType: 'type',
      userId: 'admin',
      action: 'draft',
      body: {
        metadataTypeCode: 'NewType',
        displayName: 'New Type',
        valueDataType: 'Enum',
        multiSelectAllowed: false,
        applicableModules: [],
        status: 'ACTIVE',
      },
    });

    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.ADD);
    expect(result.baseVersion).toBeNull();
  });
});
