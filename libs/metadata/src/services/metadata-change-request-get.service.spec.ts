import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  ConflictError,
  ValidationError,
} from '@api-hub/metadata';
import type { ChangeRequestRecord } from '../models/change-request.types';

const mockGetChangeRequest = jest.fn();
const mockGetMetadataRepository = jest.fn();

jest.mock('../dynamodb/dynamodb.client', () => ({
  getMetadataRepository: () => mockGetMetadataRepository(),
  getRelationRepository: jest.fn(),
  getMetadataRegistryDynamoContext: jest.fn(),
}));

import { getDraftChangeRequest } from './metadata-change-request.service';

const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function draftRecord(overrides: Partial<ChangeRequestRecord> = {}): ChangeRequestRecord {
  return {
    changeRequestId: VALID_ULID,
    status: CHANGE_REQUEST_STATUS.DRAFT,
    entityType: 'value',
    operation: CHANGE_REQUEST_OPERATION.UPDATE,
    metadataTypeCode: 'Condition',
    metadataValueCode: 'HYPERTENSION',
    baseVersion: 2,
    proposedPayload: {
      metadataTypeCode: 'Condition',
      metadataValueCode: 'HYPERTENSION',
      label: 'Hypertension',
      status: 'ACTIVE',
    },
    createdAt: '2026-06-22T10:00:00.000Z',
    createdBy: 'user-1',
    lastModifiedAt: '2026-06-22T10:30:00.000Z',
    lastModifiedBy: 'user-1',
    ...overrides,
  };
}

describe('getDraftChangeRequest', () => {
  beforeEach(() => {
    mockGetChangeRequest.mockReset();
    mockGetMetadataRepository.mockReset();
    mockGetMetadataRepository.mockResolvedValue({
      getChangeRequest: mockGetChangeRequest,
    });
  });

  it('returns draft by changeRequestId with proposedPayload', async () => {
    mockGetChangeRequest.mockResolvedValue(draftRecord());

    const result = await getDraftChangeRequest(VALID_ULID);

    expect(mockGetChangeRequest).toHaveBeenCalledWith(VALID_ULID);
    expect(result).toEqual({
      changeRequestId: VALID_ULID,
      status: CHANGE_REQUEST_STATUS.DRAFT,
      entityType: 'value',
      operation: CHANGE_REQUEST_OPERATION.UPDATE,
      metadataTypeCode: 'Condition',
      metadataValueCode: 'HYPERTENSION',
      baseVersion: 2,
      proposedPayload: {
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HYPERTENSION',
        label: 'Hypertension',
        status: 'ACTIVE',
      },
      createdAt: '2026-06-22T10:00:00.000Z',
      createdBy: 'user-1',
      lastModifiedAt: '2026-06-22T10:30:00.000Z',
      lastModifiedBy: 'user-1',
    });
  });

  it('does not expose internal DynamoDB or publish-only fields', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({
        changeRevision: 99,
        publishedAt: '2026-06-22T11:00:00.000Z',
        cancelledAt: '2026-06-22T11:00:00.000Z',
        cancelledBy: 'user-2',
      }),
    );

    const result = await getDraftChangeRequest(VALID_ULID);

    expect(result).not.toHaveProperty('PK');
    expect(result).not.toHaveProperty('SK');
    expect(result).not.toHaveProperty('changeRevision');
    expect(result).not.toHaveProperty('publishedAt');
    expect(result).not.toHaveProperty('cancelledAt');
    expect(result).not.toHaveProperty('cancelledBy');
    expect(result.proposedPayload).toEqual(
      expect.objectContaining({ metadataValueCode: 'HYPERTENSION' }),
    );
  });

  it('throws CHANGE_REQUEST_NOT_FOUND when change request is missing', async () => {
    mockGetChangeRequest.mockResolvedValue(null);

    await expect(getDraftChangeRequest(VALID_ULID)).rejects.toMatchObject({
      name: 'NotFoundError',
      statusCode: 404,
      code: 'CHANGE_REQUEST_NOT_FOUND',
    });
  });

  it('throws CHANGE_REQUEST_NOT_DRAFT when status is not DRAFT', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({ status: CHANGE_REQUEST_STATUS.PUBLISHED }),
    );

    await expect(getDraftChangeRequest(VALID_ULID)).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
      code: 'CHANGE_REQUEST_NOT_DRAFT',
    });
  });

  it('rejects cancelled change requests', async () => {
    mockGetChangeRequest.mockResolvedValue(
      draftRecord({ status: CHANGE_REQUEST_STATUS.CANCELLED }),
    );

    await expect(getDraftChangeRequest(VALID_ULID)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('assertChangeRequestIdPathParam', () => {
  const { assertChangeRequestIdPathParam } = jest.requireActual('../validators/registry-route.validation');

  it('accepts a valid ULID', () => {
    expect(assertChangeRequestIdPathParam(VALID_ULID)).toBe(VALID_ULID);
  });

  it('rejects empty changeRequestId', () => {
    expect(() => assertChangeRequestIdPathParam('')).toThrow(ValidationError);
  });

  it('rejects non-ULID identifiers', () => {
    expect(() => assertChangeRequestIdPathParam('cr_abc123')).toThrow(ValidationError);
  });
});
