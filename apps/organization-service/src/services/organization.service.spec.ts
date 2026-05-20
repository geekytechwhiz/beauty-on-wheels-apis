import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { OrganizationService } from './organization.service';
import { OrgConfigEntityType, OrgConfigStatus } from '../models';

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
  createPerformanceTimer: () => ({
    end: jest.fn(),
  }),
  serializeError: (err: Error) => ({ message: err.message }),
}));

jest.mock('../events/event.publisher', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined as never),
}));

describe('OrganizationService organizationConfig updates', () => {
  const repository = {
    getOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    getLatestOrganizationConfig: jest.fn(),
    createOrganizationConfigVersion: jest.fn(),
  } as any;

  const userRepository = {} as any;
  const secretManagerService = {
    addApiKey: jest.fn(),
  } as any;

  const service = new OrganizationService(repository, userRepository, secretManagerService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('merges organizationConfig patch with latest active config', async () => {
    repository.getOrganization
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        name: 'Org 1',
      })
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        name: 'Org 1',
      });

    repository.getLatestOrganizationConfig.mockResolvedValue({
      pk: 'ORG#org-1',
      sk: 'CONFIG#v1',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 1,
      supportedCountries: ['IN'],
      supportedLanguages: ['en'],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_A'],
      status: OrgConfigStatus.ACTIVE,
      createdAt: 1,
      updatedAt: 1,
    });

    repository.createOrganizationConfigVersion.mockResolvedValue({
      version: 2,
    });

    await service.updateOrganization(
      'org-1',
      {
        organizationConfig: {
          supportedLanguages: ['en', 'es'],
          supportedConditions: ['COND_B'],
        },
      },
      'corr-1',
    );

    expect(repository.updateOrganization).not.toHaveBeenCalled();
    expect(repository.createOrganizationConfigVersion).toHaveBeenCalledWith('org-1', {
      supportedCountries: ['IN'],
      supportedLanguages: ['en', 'es'],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_B'],
    });
  });

  it('does not create a new config version when merged config is unchanged', async () => {
    repository.getOrganization
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        name: 'Org 1',
      })
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        name: 'Org 1',
      });

    repository.getLatestOrganizationConfig.mockResolvedValue({
      pk: 'ORG#org-1',
      sk: 'CONFIG#v3',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 3,
      supportedCountries: ['IN'],
      supportedLanguages: ['en', 'hi'],
      supportedStates: ['KA'],
      supportedCategories: ['CARDIO'],
      supportedConditions: ['STABLE'],
      status: OrgConfigStatus.ACTIVE,
      createdAt: 1,
      updatedAt: 1,
    });

    await service.updateOrganization(
      'org-1',
      {
        organizationConfig: {
          supportedLanguages: ['en', 'hi'],
        },
      },
      'corr-1',
    );

    expect(repository.createOrganizationConfigVersion).not.toHaveBeenCalled();
  });

  it('returns latest organizationConfig in getOrganization response', async () => {
    repository.getOrganization.mockResolvedValue({
      organizationId: 'org-1',
      name: 'Org 1',
    });
    repository.getLatestOrganizationConfig.mockResolvedValue({
      pk: 'ORG#org-1',
      sk: 'CONFIG#v4',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 4,
      supportedCountries: ['IN'],
      supportedLanguages: ['en'],
      supportedStates: ['KA'],
      supportedCategories: ['CARDIO'],
      supportedConditions: ['STABLE'],
      status: OrgConfigStatus.ACTIVE,
      createdAt: 1,
      updatedAt: 1,
    });

    const response = await service.getOrganization('org-1');

    expect(response.organizationConfig).toEqual({
      supportedCountries: ['IN'],
      supportedLanguages: ['en'],
      supportedStates: ['KA'],
      supportedCategories: ['CARDIO'],
      supportedConditions: ['STABLE'],
    });
    expect(response.organizationConfigVersion).toBe(4);
  });

  describe('getOrganizationConfig', () => {
    it('returns wrapped latest organizationConfig when present', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getLatestOrganizationConfig.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v4',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 4,
        supportedCountries: ['IN'],
        supportedLanguages: ['en'],
        supportedStates: ['KA'],
        supportedCategories: ['CARDIO'],
        supportedConditions: ['STABLE'],
        status: OrgConfigStatus.ACTIVE,
        createdAt: 1,
        updatedAt: 1,
      });

      const response = await service.getOrganizationConfig('org-1');

      expect(response).toEqual({
        organizationId: 'org-1',
        organizationConfig: {
          supportedCountries: ['IN'],
          supportedLanguages: ['en'],
          supportedStates: ['KA'],
          supportedCategories: ['CARDIO'],
          supportedConditions: ['STABLE'],
        },
        organizationConfigVersion: 4,
      });
    });

    it('returns only organizationId when no config record exists', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getLatestOrganizationConfig.mockResolvedValue(null);

      const response = await service.getOrganizationConfig('org-1');

      expect(response).toEqual({ organizationId: 'org-1' });
    });

    it('throws OrganizationNotFoundError when org does not exist', async () => {
      repository.getOrganization.mockResolvedValue(null);

      await expect(service.getOrganizationConfig('missing-org')).rejects.toThrow(/missing-org/);
      expect(repository.getLatestOrganizationConfig).not.toHaveBeenCalled();
    });
  });
});

