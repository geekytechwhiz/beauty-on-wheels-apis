import { STATUS } from '../constants';
import {
  CHANGE_MANAGEMENT_DELETE_REQUIRED_MESSAGE,
  CHANGE_MANAGEMENT_STATUS_REQUIRED_MESSAGE,
  ChangeManagementRequiredError,
  ConflictError,
} from '../domain/errors';
import {
  CHANGE_POLICY_OPERATION,
  POLICY_GROUP,
  VERSION_IMPACT,
} from '../change-policy';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  type ChangeRequestRecord,
} from '../models/change-request.types';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';

const mockSaveChangeRequestDraft = jest.fn();
const mockGetChangeRequest = jest.fn();
const mockGetMetadataType = jest.fn();
const mockGetMetadataValue = jest.fn();
const mockSoftDeleteMetadataValue = jest.fn();
const mockUpdateMetadataValue = jest.fn();
const mockUpdateMetadataValueInPlace = jest.fn();
const mockMarkChangeRequestPublished = jest.fn();
const mockInactivateAllRelationsInvolvingMetadataValue = jest.fn();
const mockGetMetadataRepository = jest.fn();
const mockGetRelationRepository = jest.fn();

jest.mock('../dynamodb/dynamodb.client', () => ({
  getMetadataRepository: () => mockGetMetadataRepository(),
  getRelationRepository: () => mockGetRelationRepository(),
  getMetadataRegistryDynamoContext: jest.fn(),
}));

jest.mock('./metadata-value-relation.service', () => ({
  validateValueRelationshipsPayload: jest.fn(),
  assertRelationshipTargetsReferenceValidValues: jest.fn(),
  syncMetadataValueRelationships: jest.fn(),
  resolveRelationshipsForApi: jest.fn(),
  inactivateAllRelationsInvolvingMetadataValue: (...args: unknown[]) =>
    mockInactivateAllRelationsInvolvingMetadataValue(...args),
}));

import { orchestrateRegistryPatchStatus, orchestrateRegistryDeleteMetadataValue } from './metadata.service';
import { orchestrateRegistryPostDraft } from './metadata-change-request.service';
import { orchestrateRegistryPostImpactPreview } from './metadata-impact-preview.service';
import { publishChangeRequest } from './metadata-publish.service';
import {
  orchestrateRegistryDeleteMetadataValueDraft,
  orchestrateRegistryDeleteMetadataValueImpactPreview,
} from './metadata-value-retire.service';

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
    attributes: { dataType: 'Numeric' },
    applicability: { module: [], category: [], condition: [], country: [] },
    applSkKeys: [],
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

function retireDraftRecord(overrides: Partial<ChangeRequestRecord> = {}): ChangeRequestRecord {
  return {
    changeRequestId: 'cr_retire_001',
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
      status: STATUS.DELETED,
      isGlobal: true,
      valueAttributes: { dataType: 'Numeric' },
      applicableModules: [],
      applicableCategories: [],
      applicableConditions: [],
      applicableCountries: [],
      applicableLanguages: [],
      deleteReason: 'Obsolete',
    },
    createdAt: '2020-01-01',
    lastModifiedAt: '2020-01-01',
    ...overrides,
  };
}

describe('change management enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMetadataRepository.mockResolvedValue({
      getMetadataType: mockGetMetadataType,
      getMetadataValue: mockGetMetadataValue,
      saveChangeRequestDraft: mockSaveChangeRequestDraft,
      getChangeRequest: mockGetChangeRequest,
      softDeleteMetadataValue: mockSoftDeleteMetadataValue,
      updateMetadataValue: mockUpdateMetadataValue,
      updateMetadataValueInPlace: mockUpdateMetadataValueInPlace,
      markChangeRequestPublished: mockMarkChangeRequestPublished,
    });
    mockGetRelationRepository.mockResolvedValue({});
    mockSaveChangeRequestDraft.mockImplementation(async (record: unknown) => record);
    mockGetMetadataType.mockResolvedValue(minimalType('MetricCode'));
    mockMarkChangeRequestPublished.mockImplementation(async () =>
      retireDraftRecord({ status: CHANGE_REQUEST_STATUS.PUBLISHED, changeRevision: 7 }),
    );
  });

  describe('PATCH status legacy route', () => {
    it('returns CHANGE_MANAGEMENT_REQUIRED for type status patch', async () => {
      await expect(
        orchestrateRegistryPatchStatus({
          entityType: 'type',
          metadataTypeCode: 'MetricCode',
          status: STATUS.INACTIVE,
          body: { metadataTypeCode: 'MetricCode', status: 'INACTIVE' },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CHANGE_MANAGEMENT_REQUIRED',
        message: CHANGE_MANAGEMENT_STATUS_REQUIRED_MESSAGE,
      });
    });

    it('returns CHANGE_MANAGEMENT_REQUIRED for value status patch', async () => {
      await expect(
        orchestrateRegistryPatchStatus({
          entityType: 'value',
          metadataTypeCode: 'MetricCode',
          valueCode: 'BP_SYSTOLIC',
          status: STATUS.INACTIVE,
          body: { metadataTypeCode: 'MetricCode', metadataValueCode: 'BP_SYSTOLIC', status: 'INACTIVE' },
        }),
      ).rejects.toBeInstanceOf(ChangeManagementRequiredError);
    });

    it('creates draft when action=draft is provided', async () => {
      mockGetMetadataType.mockResolvedValue(
        minimalType('StatusLifeCycleTesting', { status: STATUS.INACTIVE }),
      );

      const result = await orchestrateRegistryPatchStatus({
        entityType: 'type',
        metadataTypeCode: 'StatusLifeCycleTesting',
        status: STATUS.ACTIVE,
        action: 'draft',
        body: { metadataTypeCode: 'StatusLifeCycleTesting', status: 'ACTIVE' },
      });

      expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
      const saved = mockSaveChangeRequestDraft.mock.calls[0][0];
      expect(saved.proposedPayload.status).toBe(STATUS.ACTIVE);
    });
  });

  describe('PATCH delete legacy route', () => {
    it('returns CHANGE_MANAGEMENT_REQUIRED without action', async () => {
      await expect(
        orchestrateRegistryDeleteMetadataValue({
          metadataTypeCode: 'MetricCode',
          valueCode: 'BP_SYSTOLIC',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CHANGE_MANAGEMENT_REQUIRED',
        message: CHANGE_MANAGEMENT_DELETE_REQUIRED_MESSAGE,
      });
    });
  });

  describe('status change via draft → impact-preview → publish', () => {
    beforeEach(() => {
      mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));
    });

    it('creates draft with proposed status INACTIVE', async () => {
      const result = await orchestrateRegistryPostDraft({
        entityType: 'value',
        userId: 'admin',
        action: 'draft',
        body: {
          metadataTypeCode: 'MetricCode',
          metadataValueCode: 'BP_SYSTOLIC',
          status: 'INACTIVE',
        },
      });

      expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
      expect(result.baseVersion).toBe(3);
      const saved = mockSaveChangeRequestDraft.mock.calls[0][0];
      expect(saved.proposedPayload.status).toBe(STATUS.INACTIVE);
      expect(mockSaveChangeRequestDraft).toHaveBeenCalled();
    });

    it('impact preview classifies INACTIVE as Inactivate / AVAILABILITY_STATUS', async () => {
      const preview = await orchestrateRegistryPostImpactPreview({
        entityType: 'value',
        userId: 'admin',
        action: 'impact-preview',
        body: {
          metadataTypeCode: 'MetricCode',
          metadataValueCode: 'BP_SYSTOLIC',
          status: 'INACTIVE',
        },
      });

      const statusField = preview.changedFields.find((f) => f.objectPath === 'MetadataValue.Status');
      expect(statusField?.operation).toBe(CHANGE_POLICY_OPERATION.INACTIVATE);
      expect(statusField?.policyGroup).toBe(POLICY_GROUP.AVAILABILITY_STATUS);
      expect(preview.confirmationRequired).toBe(true);
    });

    it('publish INACTIVE inactivates relations', async () => {
      mockGetChangeRequest.mockResolvedValue({
        changeRequestId: 'cr_inactivate_001',
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
          status: STATUS.INACTIVE,
          isGlobal: true,
          valueAttributes: { dataType: 'Numeric' },
          applicableModules: [],
          applicableCategories: [],
          applicableConditions: [],
          applicableCountries: [],
          applicableLanguages: [],
        },
        createdAt: '2020-01-01',
        lastModifiedAt: '2020-01-01',
      });
      mockUpdateMetadataValue.mockResolvedValue(
        minimalValue('MetricCode', 'BP_SYSTOLIC', { status: STATUS.INACTIVE, version: 4 }),
      );

      await publishChangeRequest(
        {
          changeRequestId: 'cr_inactivate_001',
          confirmationAcknowledged: true,
          expectedBaseVersion: 3,
        },
        'admin',
      );

      expect(mockInactivateAllRelationsInvolvingMetadataValue).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'MetricCode',
        'BP_SYSTOLIC',
        'admin',
      );
    });
  });

  describe('soft delete via action-based delete route', () => {
    beforeEach(() => {
      mockGetMetadataValue.mockResolvedValue(minimalValue('MetricCode', 'BP_SYSTOLIC'));
    });

    it('draft creates retire change request with status DELETED', async () => {
      const result = await orchestrateRegistryDeleteMetadataValueDraft({
        metadataTypeCode: 'MetricCode',
        valueCode: 'BP_SYSTOLIC',
        reason: 'Obsolete',
        userId: 'admin',
      });

      expect(result.operation).toBe(CHANGE_REQUEST_OPERATION.UPDATE);
      const saved = mockSaveChangeRequestDraft.mock.calls[0][0];
      expect(saved.proposedPayload.status).toBe(STATUS.DELETED);
      expect(saved.proposedPayload.deleteReason).toBe('Obsolete');
    });

    it('impact preview classifies retire as Retire / AVAILABILITY_STATUS', async () => {
      const preview = await orchestrateRegistryDeleteMetadataValueImpactPreview({
        metadataTypeCode: 'MetricCode',
        valueCode: 'BP_SYSTOLIC',
        reason: 'Obsolete',
      });

      const statusField = preview.changedFields.find((f) => f.objectPath === 'MetadataValue.Status');
      expect(statusField?.operation).toBe(CHANGE_POLICY_OPERATION.RETIRE);
      expect(statusField?.policyGroup).toBe(POLICY_GROUP.AVAILABILITY_STATUS);
      expect(preview.impactSummary.versionImpact).toBe(VERSION_IMPACT.BREAKING);
      expect(preview.confirmationRequired).toBe(true);
    });

    it('publish retire writes DELETED version and inactivates relations', async () => {
      mockGetChangeRequest.mockResolvedValue(retireDraftRecord());
      mockSoftDeleteMetadataValue.mockResolvedValue(
        minimalValue('MetricCode', 'BP_SYSTOLIC', { status: STATUS.DELETED, version: 4 }),
      );

      const result = await publishChangeRequest(
        {
          changeRequestId: 'cr_retire_001',
          confirmationAcknowledged: true,
          expectedBaseVersion: 3,
        },
        'admin',
      );

      expect(mockSoftDeleteMetadataValue).toHaveBeenCalledWith('MetricCode', 'BP_SYSTOLIC', {
        reason: 'Obsolete',
        actor: 'admin',
      });
      expect(mockInactivateAllRelationsInvolvingMetadataValue).toHaveBeenCalled();
      expect(result.record.status).toBe(STATUS.DELETED);
    });

    it('rejects draft on already deleted value', async () => {
      mockGetMetadataValue.mockResolvedValue(
        minimalValue('MetricCode', 'BP_SYSTOLIC', { status: STATUS.DELETED }),
      );

      await expect(
        orchestrateRegistryDeleteMetadataValueDraft({
          metadataTypeCode: 'MetricCode',
          valueCode: 'BP_SYSTOLIC',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects normal update draft on deleted value', async () => {
      mockGetMetadataValue.mockResolvedValue(
        minimalValue('MetricCode', 'BP_SYSTOLIC', { status: STATUS.DELETED }),
      );

      await expect(
        orchestrateRegistryPostDraft({
          entityType: 'value',
          action: 'draft',
          body: {
            metadataTypeCode: 'MetricCode',
            metadataValueCode: 'BP_SYSTOLIC',
            label: 'BP Systolic',
            status: 'ACTIVE',
            isGlobal: true,
          },
        }),
      ).rejects.toMatchObject({ code: 'VALUE_ALREADY_DELETED' });
    });
  });
});
