import { STATUS } from '../constants';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  type ChangeRequestRecord,
} from '../models/change-request.types';
import { PUBLISH_VERSION_STRATEGY } from '../publish/publish-version.strategy';
import type { MetadataPublishRequestBody } from '../validators/registry-route.validation';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';

const mockGetChangeRequest = jest.fn();
const mockGetMetadataType = jest.fn();
const mockGetMetadataValue = jest.fn();
const mockCreateMetadataValue = jest.fn();
const mockUpdateMetadataValue = jest.fn();
const mockUpdateMetadataValueInPlace = jest.fn();
const mockCreateMetadataType = jest.fn();
const mockUpdateMetadataType = jest.fn();
const mockUpdateMetadataTypeInPlace = jest.fn();
const mockMarkChangeRequestPublished = jest.fn();
const mockGetMetadataRepository = jest.fn();
const mockGetRelationRepository = jest.fn();
const mockSyncMetadataValueRelationships = jest.fn();

jest.mock('../dynamodb/dynamodb.client', () => ({
  getMetadataRepository: () => mockGetMetadataRepository(),
  getRelationRepository: () => mockGetRelationRepository(),
  getMetadataRegistryDynamoContext: jest.fn(),
}));

jest.mock('./metadata-value-relation.service', () => ({
  validateValueRelationshipsPayload: jest.fn(),
  assertRelationshipTargetsReferenceValidValues: jest.fn(),
  syncMetadataValueRelationships: (...args: unknown[]) => mockSyncMetadataValueRelationships(...args),
}));

import { publishChangeRequest, orchestrateRegistryPostPublish } from './metadata-publish.service';

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
    changeRequestId: 'cr_publish_001',
    status: CHANGE_REQUEST_STATUS.DRAFT,
    entityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: 'MetricCode',
    metadataValueCode: 'BP_SYSTOLIC',
    baseVersion: 3,
    proposedPayload: {
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
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

function publishRequest(overrides: Partial<MetadataPublishRequestBody> = {}): MetadataPublishRequestBody {
  return {
    changeRequestId: 'cr_publish_001',
    confirmationAcknowledged: false,
    expectedBaseVersion: 3,
    ...overrides,
  };
}

describe('publishChangeRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMetadataRepository.mockResolvedValue({
      getChangeRequest: mockGetChangeRequest,
      getMetadataType: mockGetMetadataType,
      getMetadataValue: mockGetMetadataValue,
      createMetadataValue: mockCreateMetadataValue,
      updateMetadataValue: mockUpdateMetadataValue,
      updateMetadataValueInPlace: mockUpdateMetadataValueInPlace,
      createMetadataType: mockCreateMetadataType,
      updateMetadataType: mockUpdateMetadataType,
      updateMetadataTypeInPlace: mockUpdateMetadataTypeInPlace,
      markChangeRequestPublished: mockMarkChangeRequestPublished,
    });
    mockGetRelationRepository.mockResolvedValue({});
    mockGetMetadataType.mockResolvedValue(minimalType('MetricCode'));
    mockMarkChangeRequestPublished.mockImplementation(async (_id, _params) =>
      draftRecord({ status: CHANGE_REQUEST_STATUS.PUBLISHED, changeRevision: 42, publishedAt: '2026-01-01' }),
    );
  });

  it('publishes display-only value update IN_PLACE without APPL sync', async () => {
    mockGetChangeRequest.mockResolvedValue(draftRecord());
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC', { label: 'BP Systolic' }));
    mockUpdateMetadataValueInPlace.mockResolvedValue(
      minimalValue('MetricCode', 'BP_SYSTOLIC', { label: 'BP Systolic (display)', version: 3 }),
    );

    const result = await publishChangeRequest(
      publishRequest({ confirmationAcknowledged: false, expectedBaseVersion: 3 }),
      'admin@test.com',
    );

    expect(result.publishStrategy).toBe(PUBLISH_VERSION_STRATEGY.IN_PLACE);
    expect(result.version).toBe(3);
    expect(result.changeRevision).toBe(42);
    expect(result.impactSummary.requiresMetadataVersion).toBe(false);
    expect(mockUpdateMetadataValueInPlace).toHaveBeenCalled();
    expect(mockUpdateMetadataValue).not.toHaveBeenCalled();
    expect(mockMarkChangeRequestPublished).toHaveBeenCalled();
  });

  it('publishes behavioral value update as NEW_VERSION when confirmation acknowledged', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({
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
      }),
    );
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));
    mockUpdateMetadataValue.mockResolvedValue(
      minimalValue('MetricCode', 'BP_SYSTOLIC', { version: 4, attributes: { dataType: 'Numeric', unit: 'kPa' } }),
    );

    const result = await publishChangeRequest(
      publishRequest({ confirmationAcknowledged: true, expectedBaseVersion: 3 }),
    );

    expect(result.publishStrategy).toBe(PUBLISH_VERSION_STRATEGY.NEW_VERSION);
    expect(result.version).toBe(4);
    expect(mockUpdateMetadataValue).toHaveBeenCalled();
  });

  it('rejects breaking publish without confirmationAcknowledged', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({
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
      }),
    );
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));

    await expect(
      publishChangeRequest(publishRequest({ confirmationAcknowledged: false, expectedBaseVersion: 3 })),
    ).rejects.toMatchObject({ statusCode: 400, details: [{ field: 'confirmationAcknowledged' }] });

    expect(mockUpdateMetadataValue).not.toHaveBeenCalled();
  });

  it('returns 409 when expectedBaseVersion does not match current published version', async () => {
    mockGetChangeRequest.mockResolvedValue(draftRecord());
    mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC', { version: 4 }));

    await expect(
      publishChangeRequest(publishRequest({ expectedBaseVersion: 3 })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'EXPECTED_BASE_VERSION_MISMATCH' });

    expect(mockUpdateMetadataValueInPlace).not.toHaveBeenCalled();
  });

  it('publishes Add value as v1 with expectedBaseVersion null', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({
        operation: CHANGE_REQUEST_OPERATION.ADD,
        baseVersion: null,
        metadataValueCode: 'HEART_RATE',
        proposedPayload: {
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
      }),
    );
    mockGetMetadataValue.mockResolvedValue(null);
    mockCreateMetadataValue.mockResolvedValue(
      minimalValue('MetricCode', 'HEART_RATE', { version: 1, label: 'Heart Rate' }),
    );

    const result = await publishChangeRequest(
      publishRequest({
        confirmationAcknowledged: true,
        expectedBaseVersion: null,
      }),
    );

    expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.ADD);
    expect(result.version).toBe(1);
    expect(mockCreateMetadataValue).toHaveBeenCalled();
  });

  it('rejects publish when change request is not DRAFT', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({ status: CHANGE_REQUEST_STATUS.PUBLISHED }),
    );

    await expect(publishChangeRequest(publishRequest())).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpdateMetadataValue).not.toHaveBeenCalled();
  });
});

describe('orchestrateRegistryPostPublish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMetadataRepository.mockResolvedValue({
      getChangeRequest: mockGetChangeRequest,
      getMetadataType: mockGetMetadataType,
      getMetadataValue: mockGetMetadataValue,
      createMetadataValue: mockCreateMetadataValue,
      updateMetadataValue: mockUpdateMetadataValue,
      updateMetadataValueInPlace: mockUpdateMetadataValueInPlace,
      markChangeRequestPublished: mockMarkChangeRequestPublished,
    });
    mockGetRelationRepository.mockResolvedValue({});
    mockGetMetadataType.mockResolvedValue(minimalType('MetricCode'));
    mockMarkChangeRequestPublished.mockImplementation(async (_id, _params) =>
      draftRecord({ status: CHANGE_REQUEST_STATUS.PUBLISHED, changeRevision: 42, publishedAt: '2026-01-01' }),
    );
  });

  it('rejects when path entityType mismatches draft', async () => {
    mockGetChangeRequest.mockResolvedValue(draftRecord({ entityType: 'value' }));

    await expect(
      orchestrateRegistryPostPublish({
        entityType: 'type',
        action: 'publish',
        body: {
          changeRequestId: 'cr_publish_001',
          confirmationAcknowledged: false,
          expectedBaseVersion: 3,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockUpdateMetadataValue).not.toHaveBeenCalled();
  });
});
