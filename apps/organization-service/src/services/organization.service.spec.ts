import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
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

const ROOT_ADMIN = 'ROOT_ADMIN';

describe('OrganizationService organizationConfig updates', () => {
  const repository = {
    getOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    getLatestOrganizationConfig: jest.fn(),
    createOrganizationConfigVersion: jest.fn(),
    getLatestOrganizationConfigVersionItem: jest.fn(),
    createOrganizationConfigDraftVersion: jest.fn(),
  } as any;

  const userRepository = {} as any;
  const secretManagerService = {
    addApiKey: jest.fn(),
  } as any;

  const service = new OrganizationService(repository, userRepository, secretManagerService);

  const originalFlag = process.env.ENABLE_NEW_ORG_CONFIG_FLOW;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ENABLE_NEW_ORG_CONFIG_FLOW;
    } else {
      process.env.ENABLE_NEW_ORG_CONFIG_FLOW = originalFlag;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('legacy flow (ENABLE_NEW_ORG_CONFIG_FLOW=false)', () => {
    beforeEach(() => {
      process.env.ENABLE_NEW_ORG_CONFIG_FLOW = 'false';
    });

    it('merges organizationConfig patch with latest active config and creates ACTIVE version', async () => {
      repository.getOrganization
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' });

      repository.getLatestOrganizationConfig.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v1',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 1,
        supportedCountries: ['IN'],
        supportedLanguages: ['EN'],
        supportedStates: ['KA'],
        supportedCategories: ['CAT_A'],
        supportedConditions: ['COND_A'],
        status: OrgConfigStatus.ACTIVE,
        createdAt: 1,
        updatedAt: 1,
      });

      repository.createOrganizationConfigVersion.mockResolvedValue({
        version: 2,
        status: OrgConfigStatus.ACTIVE,
      });

      await service.updateOrganization(
        'org-1',
        {
          organizationConfig: {
            supportedLanguages: ['EN', 'ES'],
            supportedConditions: ['COND_B'],
          },
        },
        'corr-1',
        ROOT_ADMIN,
      );

      expect(repository.createOrganizationConfigVersion).toHaveBeenCalledWith('org-1', {
        supportedCountries: ['IN'],
        supportedLanguages: ['EN', 'ES'],
        supportedStates: ['KA'],
        supportedCategories: ['CAT_A'],
        supportedConditions: ['COND_B'],
      });
      expect(repository.createOrganizationConfigDraftVersion).not.toHaveBeenCalled();
      expect(repository.getLatestOrganizationConfigVersionItem).not.toHaveBeenCalled();
    });

    it('does not create a new config version when merged legacy config is unchanged', async () => {
      repository.getOrganization
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' });

      repository.getLatestOrganizationConfig.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v3',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 3,
        supportedCountries: ['IN'],
        supportedLanguages: ['EN', 'HI'],
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
            supportedLanguages: ['EN', 'HI'],
          },
        },
        'corr-1',
        ROOT_ADMIN,
      );

      expect(repository.createOrganizationConfigVersion).not.toHaveBeenCalled();
    });

    it('skips config update when caller is not ROOT_ADMIN', async () => {
      repository.getOrganization
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' });

      await service.updateOrganization(
        'org-1',
        {
          organizationConfig: {
            supportedLanguages: ['EN'],
          },
        },
        'corr-1',
        'ORG_ADMIN',
      );

      expect(repository.createOrganizationConfigVersion).not.toHaveBeenCalled();
      expect(repository.getLatestOrganizationConfig).not.toHaveBeenCalled();
    });

    it('includes organizationConfig in OrganizationUpdated.v1 updatedFields', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { publishEvent } = require('../events/event.publisher');
      repository.getOrganization
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1', modifiedDate: 99 })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1', modifiedDate: 99 });

      repository.getLatestOrganizationConfig.mockResolvedValue(null);
      repository.createOrganizationConfigVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.ACTIVE,
      });

      const organizationConfig = {
        supportedCountries: ['IN'],
        supportedLanguages: ['EN'],
      };

      await service.updateOrganization(
        'org-1',
        { organizationConfig },
        'corr-1',
        ROOT_ADMIN,
      );

      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'OrganizationUpdated.v1',
          payload: expect.objectContaining({
            updatedFields: expect.objectContaining({
              organizationConfig,
              organizationConfigVersion: 1,
            }),
          }),
        }),
        'corr-1',
      );
    });
  });

  describe('new flow (ENABLE_NEW_ORG_CONFIG_FLOW=true)', () => {
    beforeEach(() => {
      process.env.ENABLE_NEW_ORG_CONFIG_FLOW = 'true';
    });

    it('maps legacy organizationConfig and saves draft via new config flow', async () => {
      repository.getOrganization
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1' });

      repository.getLatestOrganizationConfigVersionItem
        .mockResolvedValueOnce({
          version: 1,
          status: OrgConfigStatus.ACTIVE,
          countryCode: 'IN',
          supportedLanguageCodes: ['EN'],
          enabledCategoryCodes: ['CAT_A'],
          enabledConditionCodes: ['COND_A'],
        })
        .mockResolvedValueOnce({
          version: 1,
          status: OrgConfigStatus.ACTIVE,
          countryCode: 'IN',
          supportedLanguageCodes: ['EN'],
          enabledCategoryCodes: ['CAT_A'],
          enabledConditionCodes: ['COND_A'],
        });

      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 2,
        status: OrgConfigStatus.DRAFT,
      });

      await service.updateOrganization(
        'org-1',
        {
          organizationConfig: {
            supportedLanguages: ['EN', 'ES'],
            supportedConditions: ['COND_B'],
          },
          modules: { MOD_A: true },
        },
        'corr-1',
        ROOT_ADMIN,
      );

      expect(repository.createOrganizationConfigVersion).not.toHaveBeenCalled();
      expect(repository.getLatestOrganizationConfig).not.toHaveBeenCalled();
      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith(
        'org-1',
        {
          countryCode: 'IN',
          defaultLanguageCode: 'EN',
          supportedLanguageCodes: ['EN', 'ES'],
          enabledCategoryCodes: ['CAT_A'],
          enabledConditionCodes: ['COND_B'],
          enabledModuleCodes: ['MOD_A'],
        },
        { changeReason: undefined, createdBy: undefined },
      );
    });

    it('keeps OrganizationUpdated.v1 payload shape with organizationConfig fields', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { publishEvent } = require('../events/event.publisher');
      repository.getOrganization
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1', modifiedDate: 99 })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1', modifiedDate: 99 })
        .mockResolvedValueOnce({ organizationId: 'org-1', name: 'Org 1', modifiedDate: 99 });

      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue(null);
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
      });

      const organizationConfig = {
        supportedCountries: ['IN'],
        supportedLanguages: ['EN'],
      };

      await service.updateOrganization(
        'org-1',
        { organizationConfig },
        'corr-1',
        ROOT_ADMIN,
      );

      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'OrganizationUpdated.v1',
          payload: expect.objectContaining({
            updatedFields: expect.objectContaining({
              organizationConfig,
              organizationConfigVersion: 1,
            }),
          }),
        }),
        'corr-1',
      );
    });
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

  describe('saveOrganizationConfig', () => {
    const sampleConfig = {
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
      defaultLanguageCode: 'en',
      supportedLanguageCodes: ['en', 'hi'],
      enabledModuleCodes: ['MOD_A'],
      enabledFeatureCodes: ['FEAT_A'],
      enabledCategoryCodes: ['CAT_A'],
      enabledConditionCodes: ['COND_A'],
      enabledMetricCodes: ['METRIC_CHECKIN'],
      enabledDeviceCodes: ['DEV_A'],
      linkedOrgReferences: ['org-2'],
      requiredAgreementIds: ['agr-1'],
    };

    it('creates CONFIG#v1 draft for the first config', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue(null);
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
      });

      const result = await service.saveOrganizationConfig('org-1', sampleConfig, 'corr-1', 'user-1');

      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith('org-1', sampleConfig, {
        changeReason: undefined,
        createdBy: 'user-1',
      });
      expect(result.created).toBe(true);
      expect(result.version).toBe(1);
      expect(result.status).toBe(OrgConfigStatus.DRAFT);
    });

    it('creates the next draft version when config changed', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue({
        version: 2,
        status: OrgConfigStatus.DRAFT,
        countryCode: 'IN',
        supportedLanguageCodes: ['en'],
      });
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 3,
        status: OrgConfigStatus.DRAFT,
      });

      const result = await service.saveOrganizationConfig(
        'org-1',
        { countryCode: 'US', changeReason: 'switch country' },
        'corr-1',
        'user-1',
      );

      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith(
        'org-1',
        { countryCode: 'US' },
        { changeReason: 'switch country', createdBy: 'user-1' },
      );
      expect(result.created).toBe(true);
      expect(result.version).toBe(3);
    });

    it('does not create a new version when config matches the latest', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue({
        version: 5,
        status: OrgConfigStatus.ACTIVE,
        ...sampleConfig,
      });

      const result = await service.saveOrganizationConfig('org-1', { ...sampleConfig }, 'corr-1', 'user-1');

      expect(repository.createOrganizationConfigDraftVersion).not.toHaveBeenCalled();
      expect(result.created).toBe(false);
      expect(result.version).toBe(5);
      expect(result.status).toBe(OrgConfigStatus.ACTIVE);
    });

    it('throws OrganizationNotFoundError when org does not exist', async () => {
      repository.getOrganization.mockResolvedValue(null);

      await expect(
        service.saveOrganizationConfig('missing-org', sampleConfig, 'corr-1', 'user-1'),
      ).rejects.toThrow(/missing-org/);
      expect(repository.getLatestOrganizationConfigVersionItem).not.toHaveBeenCalled();
      expect(repository.createOrganizationConfigDraftVersion).not.toHaveBeenCalled();
    });

    it('does not emit any event when saving config', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { publishEvent } = require('../events/event.publisher');
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue(null);
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
      });

      await service.saveOrganizationConfig('org-1', sampleConfig, 'corr-1', 'user-1');

      expect(publishEvent).not.toHaveBeenCalled();
    });
  });
});
