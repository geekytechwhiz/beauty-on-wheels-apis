import { STATUS } from '../constants';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  type ChangeRequestRecord,
} from '../models/change-request.types';
import { POLICY_GROUP } from '../change-policy';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';

const mockGetChangeRequest = jest.fn();
const mockGetMetadataType = jest.fn();
const mockGetMetadataValue = jest.fn();
const mockListMetadataValues = jest.fn();
const mockSaveChangeRequestDraft = jest.fn();
const mockCreateMetadataValue = jest.fn();
const mockUpdateMetadataValue = jest.fn();
const mockCreateMetadataType = jest.fn();
const mockUpdateMetadataType = jest.fn();
const mockGetMetadataRepository = jest.fn();

jest.mock('../dynamodb/dynamodb.client', () => ({
  getMetadataRepository: () => mockGetMetadataRepository(),
  getRelationRepository: jest.fn(),
  getMetadataRegistryDynamoContext: jest.fn(),
}));

import { orchestrateRegistryPostImpactPreview } from './metadata-impact-preview.service';

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
    attributes: { dataType: 'Numeric', unit: 'mmHg' },
    applicability: { module: [], category: [], condition: [], country: [] },
    applSkKeys: [],
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

function draftRecord(overrides: Partial<ChangeRequestRecord> = {}): ChangeRequestRecord {
  return {
    changeRequestId: 'cr_test_001',
    status: CHANGE_REQUEST_STATUS.DRAFT,
    entityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: 'MetricCode',
    metadataValueCode: 'BP_SYSTOLIC',
    baseVersion: 3,
    proposedPayload: {
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
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

describe('orchestrateRegistryPostImpactPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMetadataRepository.mockResolvedValue({
      getChangeRequest: mockGetChangeRequest,
      getMetadataType: mockGetMetadataType,
      getMetadataValue: mockGetMetadataValue,
      listMetadataValues: mockListMetadataValues,
      saveChangeRequestDraft: mockSaveChangeRequestDraft,
      createMetadataValue: mockCreateMetadataValue,
      updateMetadataValue: mockUpdateMetadataValue,
      createMetadataType: mockCreateMetadataType,
      updateMetadataType: mockUpdateMetadataType,
    });
    mockGetMetadataType.mockResolvedValue(minimalType('MetricCode'));
    mockListMetadataValues.mockResolvedValue([]);
  });

  it('previews from saved draft without writing published metadata', async () => {
    mockGetChangeRequest.mockResolvedValue(draftRecord());
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));

    const result = await orchestrateRegistryPostImpactPreview({
      entityType: 'value',
      action: 'impact-preview',
      body: { changeRequestId: 'cr_test_001' },
    });

    expect(result.changeRequestId).toBe('cr_test_001');
    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
    expect(result.baseVersion).toBe(3);
    expect(result.nextVersion).toBe(4);
    expect(result.confirmationRequired).toBe(true);
    expect(result.changedFields.some((f) => f.objectPath === 'MetricCode.ValueAttributes.unit')).toBe(true);
    expect(result.changedFields.every((f) => f.policyGroup)).toBe(true);
    expect(mockSaveChangeRequestDraft).not.toHaveBeenCalled();
    expect(mockCreateMetadataValue).not.toHaveBeenCalled();
    expect(mockUpdateMetadataValue).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/ruleId|RULE-/);
  });

  it('previews stateless payload without saving draft or publishing', async () => {
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));

    const result = await orchestrateRegistryPostImpactPreview({
      entityType: 'value',
      action: 'impact-preview',
      body: {
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'BP_SYSTOLIC',
        label: 'BP Systolic Updated',
        status: 'ACTIVE',
        isGlobal: true,
        valueAttributes: { dataType: 'Numeric', unit: 'mmHg' },
        applicableModules: [],
        applicableCategories: [],
        applicableConditions: [],
        applicableCountries: [],
        applicableLanguages: [],
      },
    });

    expect(result.changeRequestId).toBeNull();
    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
    expect(result.confirmationRequired).toBe(false);
    expect(result.nextVersion).toBe(3);
    expect(result.changedFields.some((f) => f.policyGroup === POLICY_GROUP.DISPLAY_ONLY)).toBe(true);
    expect(mockSaveChangeRequestDraft).not.toHaveBeenCalled();
    expect(mockCreateMetadataValue).not.toHaveBeenCalled();
    expect(mockUpdateMetadataValue).not.toHaveBeenCalled();
  });

  it('returns Add flow with null baseVersion and confirmation for new value', async () => {
    mockGetMetadataValue.mockResolvedValue(null);

    const result = await orchestrateRegistryPostImpactPreview({
      entityType: 'value',
      action: 'impact-preview',
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

    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.ADD);
    expect(result.baseVersion).toBeNull();
    expect(result.nextVersion).toBe(1);
    expect(result.confirmationRequired).toBe(true);
    expect(result.changedFields.every((f) => f.oldValue === null)).toBe(true);
  });

  it('sets confirmationRequired false for label-only update', async () => {
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC', { label: 'BP Systolic' }));

    const result = await orchestrateRegistryPostImpactPreview({
      entityType: 'value',
      action: 'impact-preview',
      body: {
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'BP_SYSTOLIC',
        label: 'BP Systolic (display)',
        status: 'ACTIVE',
        isGlobal: true,
        valueAttributes: { dataType: 'Numeric', unit: 'mmHg' },
        applicableModules: [],
        applicableCategories: [],
        applicableConditions: [],
        applicableCountries: [],
        applicableLanguages: [],
      },
    });

    expect(result.confirmationRequired).toBe(false);
    expect(result.nextVersion).toBe(3);
    expect(result.impactSummary.requiresMetadataVersion).toBe(false);
  });

  it('rejects draft preview when entityType path mismatches draft', async () => {
    mockGetChangeRequest.mockResolvedValue(draftRecord({ entityType: 'value' }));

    await expect(
      orchestrateRegistryPostImpactPreview({
        entityType: 'type',
        action: 'impact-preview',
        body: { changeRequestId: 'cr_test_001' },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
