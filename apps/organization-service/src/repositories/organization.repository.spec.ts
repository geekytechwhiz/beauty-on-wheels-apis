import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { OrganizationRepository } from './organization.repository';
import { OrgConfigEntityType, OrgConfigStatus } from '../models';

const mockSend: jest.Mock = jest.fn();

jest.mock('@api-hub/utils', () => ({
  ddbDocClient: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

jest.mock('@api-hub/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  createChildLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  serializeError: (err: Error) => ({ message: err.message }),
}));

describe('OrganizationRepository organization config versioning', () => {
  const repository = new OrganizationRepository();

  beforeEach(() => {
    mockSend.mockReset();
  });

  it('creates first config version when none exists', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const result = await repository.createOrganizationConfigVersion('org-1', {
      supportedCountries: ['IN'],
      supportedLanguages: ['en'],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_A'],
    });

    expect(result.version).toBe(1);
    expect(result.status).toBe(OrgConfigStatus.ACTIVE);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(mockSend.mock.calls[1][0]).toBeInstanceOf(TransactWriteCommand);

    const transactionInput = (mockSend.mock.calls[1][0] as TransactWriteCommand).input;
    expect(transactionInput.TransactItems).toHaveLength(1);
    expect((transactionInput.TransactItems?.[0] as any).Put.Item.sk).toBe('CONFIG#v1');
  });

  it('increments version and marks previous active config inactive', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            pk: 'ORG#org-1',
            sk: 'CONFIG#v2',
            entityType: OrgConfigEntityType.ORG_CONFIG,
            orgId: 'org-1',
            version: 2,
            supportedCountries: ['IN'],
            supportedLanguages: ['en'],
            supportedStates: [],
            supportedCategories: [],
            supportedConditions: [],
            status: OrgConfigStatus.ACTIVE,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({});

    const result = await repository.createOrganizationConfigVersion('org-1', {
      supportedCountries: ['IN', 'US'],
      supportedLanguages: ['en'],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_A'],
    });

    expect(result.version).toBe(3);
    expect(mockSend).toHaveBeenCalledTimes(2);

    const transactionInput = (mockSend.mock.calls[1][0] as TransactWriteCommand).input;
    expect(transactionInput.TransactItems).toHaveLength(2);
    expect((transactionInput.TransactItems?.[0] as any).Put.Item.sk).toBe('CONFIG#v3');
    expect((transactionInput.TransactItems?.[1] as any).Update.Key).toEqual({
      pk: 'ORG#org-1',
      sk: 'CONFIG#v2',
    });
  });

  it('uses latest version and deactivates current ACTIVE when latest config is not ACTIVE', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            pk: 'ORG#org-1',
            sk: 'CONFIG#v4',
            entityType: OrgConfigEntityType.ORG_CONFIG,
            orgId: 'org-1',
            version: 4,
            status: OrgConfigStatus.INACTIVE,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            pk: 'ORG#org-1',
            sk: 'CONFIG#v3',
            entityType: OrgConfigEntityType.ORG_CONFIG,
            orgId: 'org-1',
            version: 3,
            status: OrgConfigStatus.ACTIVE,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        Items: [
          {
            pk: 'ORG#org-1',
            sk: 'CONFIG#v3',
            entityType: OrgConfigEntityType.ORG_CONFIG,
            orgId: 'org-1',
            version: 3,
            status: OrgConfigStatus.ACTIVE,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({});

    const result = await repository.createOrganizationConfigVersion('org-1', {
      supportedCountries: ['IN'],
      supportedLanguages: ['en'],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_A'],
    });

    expect(result.version).toBe(5);
    expect(mockSend).toHaveBeenCalledTimes(3);

    const transactionInput = (mockSend.mock.calls[2][0] as TransactWriteCommand).input;
    expect((transactionInput.TransactItems?.[0] as any).Put.Item.sk).toBe('CONFIG#v5');
    expect((transactionInput.TransactItems?.[1] as any).Update.Key).toEqual({
      pk: 'ORG#org-1',
      sk: 'CONFIG#v3',
    });
  });

  it('getLatestOrganizationConfig prefers ACTIVE by default', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          pk: 'ORG#org-1',
          sk: 'CONFIG#v4',
          entityType: OrgConfigEntityType.ORG_CONFIG,
          orgId: 'org-1',
          version: 4,
          status: OrgConfigStatus.INACTIVE,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          pk: 'ORG#org-1',
          sk: 'CONFIG#v3',
          entityType: OrgConfigEntityType.ORG_CONFIG,
          orgId: 'org-1',
          version: 3,
          status: OrgConfigStatus.ACTIVE,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const latest = await repository.getLatestOrganizationConfig('org-1');
    expect(latest?.version).toBe(3);
    expect(latest?.status).toBe(OrgConfigStatus.ACTIVE);
  });

  it('getLatestOrganizationConfig returns newest when preferActive is false', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          pk: 'ORG#org-1',
          sk: 'CONFIG#v4',
          entityType: OrgConfigEntityType.ORG_CONFIG,
          orgId: 'org-1',
          version: 4,
          status: OrgConfigStatus.INACTIVE,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          pk: 'ORG#org-1',
          sk: 'CONFIG#v3',
          entityType: OrgConfigEntityType.ORG_CONFIG,
          orgId: 'org-1',
          version: 3,
          status: OrgConfigStatus.ACTIVE,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const latest = await repository.getLatestOrganizationConfig('org-1', { preferActive: false });
    expect(latest?.version).toBe(4);
    expect(latest?.status).toBe(OrgConfigStatus.INACTIVE);
  });
});

