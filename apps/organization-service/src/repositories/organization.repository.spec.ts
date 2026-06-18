/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { OrganizationRepository } from './organization.repository';
import { OrgConfigEntityType, OrgConfigStatus, ORG_CONFIG_CHANGE_TYPE } from '../models';

const mockSend = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@api-hub/utils', () => ({
  ddbDocClient: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

jest.mock('@api-hub/observability', () => ({
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
        ] as any,
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

  describe('config draft save (TLH-12120)', () => {
    it('getLatestOrganizationConfigVersionItem picks the highest numeric version (v10 > v9)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            pk: 'ORG#org-1',
            sk: 'CONFIG#v9',
            entityType: OrgConfigEntityType.ORG_CONFIG,
            orgId: 'org-1',
            version: 9,
            status: OrgConfigStatus.DRAFT,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            pk: 'ORG#org-1',
            sk: 'CONFIG#v10',
            entityType: OrgConfigEntityType.ORG_CONFIG,
            orgId: 'org-1',
            version: 10,
            status: OrgConfigStatus.DRAFT,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });

      const latest = await repository.getLatestOrganizationConfigVersionItem('org-1');
      expect(latest?.version).toBe(10);
    });

    it('creates first draft config as CONFIG#v1 with status draft', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});

      const result = await repository.createOrganizationConfigDraftVersion(
        'org-1',
        { enabledCountryCodes: ['IN'], enabledModuleCodes: ['MOD_A'] },
        { createdBy: 'user-1' },
      );

      expect(result.version).toBe(1);
      expect(result.sk).toBe('CONFIG#v1');
      expect(result.status).toBe(OrgConfigStatus.DRAFT);
      expect(result.createdBy).toBe('user-1');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(PutCommand);
      const putItem = (mockSend.mock.calls[1][0] as PutCommand).input.Item as any;
      expect(putItem.entityType).toBe(OrgConfigEntityType.ORG_CONFIG);
      expect(putItem.enabledCountryCodes).toEqual(['IN']);
      expect(putItem.enabledModuleCodes).toEqual(['MOD_A']);
    });

    it('persists enabledCountryCodes on draft config items', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});

      await repository.createOrganizationConfigDraftVersion('org-1', {
        enabledCountryCodes: ['IN', 'US', 'AE'],
      });

      const putItem = (mockSend.mock.calls[1][0] as PutCommand).input.Item as any;
      expect(putItem.enabledCountryCodes).toEqual(['IN', 'US', 'AE']);
    });

    it('increments to the next version and does NOT deactivate previous versions', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [
            {
              pk: 'ORG#org-1',
              sk: 'CONFIG#v2',
              entityType: OrgConfigEntityType.ORG_CONFIG,
              orgId: 'org-1',
              version: 2,
              status: OrgConfigStatus.ACTIVE,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        })
        .mockResolvedValueOnce({});

      const result = await repository.createOrganizationConfigDraftVersion(
        'org-1',
        { enabledCountryCodes: ['US'] },
        { changeReason: 'switch' },
      );

      expect(result.version).toBe(3);
      expect(result.sk).toBe('CONFIG#v3');
      expect(result.status).toBe(OrgConfigStatus.DRAFT);
      // Single Put only — no TransactWrite, so no previous version is deactivated.
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(PutCommand);
      expect(mockSend.mock.calls[1][0]).not.toBeInstanceOf(TransactWriteCommand);
    });
  });

  describe('publishOrganizationConfigVersion', () => {
    const draftItem = {
      pk: 'ORG#org-1',
      sk: 'CONFIG#v5',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 5,
      status: OrgConfigStatus.DRAFT,
      enabledCategoryCodes: ['CHRONIC'],
      enabledConditionCodes: ['HYPERTENSION'],
      createdAt: 1,
      updatedAt: 1,
    };

    const activeItem = {
      pk: 'ORG#org-1',
      sk: 'CONFIG#v4',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 4,
      status: OrgConfigStatus.ACTIVE,
      createdAt: 1,
      updatedAt: 1,
    };

    it('activates draft and deactivates previous ACTIVE config in one transaction', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: draftItem })
        .mockResolvedValueOnce({ Items: [activeItem, draftItem] })
        .mockResolvedValueOnce({});

      const result = await repository.publishOrganizationConfigVersion('org-1', 5, {
        publishedAt: 1000,
        changedSections: ['enabledCategoryCodes'],
        changeType: ORG_CONFIG_CHANGE_TYPE.UPDATE,
        orgCapabilities: ['CAP-CHRONIC__HYPERTENSION'],
        publishedBy: 'user-1',
      });

      expect(result.status).toBe(OrgConfigStatus.ACTIVE);
      expect(result.version).toBe(5);
      expect(result.orgCapabilities).toEqual(['CAP-CHRONIC__HYPERTENSION']);

      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(GetCommand);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(QueryCommand);
      expect(mockSend.mock.calls[2][0]).toBeInstanceOf(TransactWriteCommand);

      const transactionInput = (mockSend.mock.calls[2][0] as TransactWriteCommand).input;
      expect(transactionInput.TransactItems).toHaveLength(2);
      expect((transactionInput.TransactItems?.[0] as any).Update.ExpressionAttributeValues[':active']).toBe(
        OrgConfigStatus.ACTIVE,
      );
      expect((transactionInput.TransactItems?.[1] as any).Update.ExpressionAttributeValues[':inactive']).toBe(
        OrgConfigStatus.INACTIVE,
      );
    });
  });
});

