import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { OrganizationService } from './organization.service';
import { OrgConfigEntityType, OrgConfigStatus, ORG_CONFIG_CHANGE_TYPE } from '../models';
import { EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS } from '../utils/organizationConfig.enrichment';
import { ORG_CONFIG_METADATA_TYPE_MAPPING } from '../utils/organizationConfig.metadata-types';
import {
  OrgConfigPublishError,
} from '../utils/errors';

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

import { publishOrgConfigPublishedEvent } from '../handlers/events/publisher/org-config-publisher';

const mockPublishOrgConfigPublishedEvent = jest.mocked(publishOrgConfigPublishedEvent);

const ROOT_ADMIN = 'ROOT_ADMIN';

describe('OrganizationService organizationConfig updates', () => {
  const repository = {
    getOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    getLatestOrganizationConfig: jest.fn(),
    createOrganizationConfigVersion: jest.fn(),
    getLatestOrganizationConfigVersionItem: jest.fn(),
    createOrganizationConfigDraftVersion: jest.fn(),
    getOrganizationConfigByVersion: jest.fn(),
    getLatestDraftOrganizationConfig: jest.fn(),
    getActiveOrganizationConfigItem: jest.fn(),
    publishOrganizationConfigVersion: jest.fn(),
  } as any;

  const userRepository = {} as any;
  const secretManagerService = {
    addApiKey: jest.fn(),
  } as any;

  const metadataRegistryClient = {
    getValuesByTypes: jest.fn(),
    getRelatedValues: jest.fn(),
  } as any;

  const service = new OrganizationService(
    repository,
    userRepository,
    secretManagerService,
    metadataRegistryClient,
  );

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
    mockPublishOrgConfigPublishedEvent.mockResolvedValue(undefined);
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
          enabledCountryCodes: ['IN'],
          supportedLanguageCodes: ['EN'],
          enabledCategoryCodes: ['CAT_A'],
          enabledConditionCodes: ['COND_A'],
        })
        .mockResolvedValueOnce({
          version: 1,
          status: OrgConfigStatus.ACTIVE,
          enabledCountryCodes: ['IN'],
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
          enabledCountryCodes: ['IN'],
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

  it('returns enriched organizationConfig in getOrganization response', async () => {
    repository.getOrganization.mockResolvedValue({
      organizationId: 'org-1',
      name: 'Org 1',
    });
    repository.getActiveOrganizationConfigItem.mockResolvedValue({
      pk: 'ORG#org-1',
      sk: 'CONFIG#v4',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 4,
      enabledCountryCodes: ['IN'],
      defaultLanguageCode: 'EN',
      enabledCategoryCodes: ['CARDIO'],
      enabledConditionCodes: ['STABLE'],
      status: OrgConfigStatus.ACTIVE,
      createdAt: 1,
      updatedAt: 1,
    });
    metadataRegistryClient.getValuesByTypes.mockResolvedValue({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: false,
          valueDataType: 'string',
          values: [{ valueCode: 'IN', label: 'India', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
        },
        {
          metadataType: 'Language',
          displayName: 'Language',
          multiSelectAllowed: false,
          valueDataType: 'string',
          values: [{ valueCode: 'EN', label: 'English', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
        },
        {
          metadataType: 'Category',
          displayName: 'Category',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [{ valueCode: 'CARDIO', label: 'Cardiology', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
        },
        {
          metadataType: 'Condition',
          displayName: 'Condition',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [{ valueCode: 'STABLE', label: 'Stable', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
        },
      ],
      missingMetadataTypeCodes: [],
    });
    metadataRegistryClient.getRelatedValues.mockResolvedValue({ groups: [] });

    const response = await service.getOrganization('org-1', { authHeader: 'Bearer token' });

    expect(response.organizationConfig).toEqual({
      enabledCountryCodes: [{ code: 'IN', label: 'India' }],
      defaultLanguageCode: { code: 'EN', label: 'English' },
      enabledCategoryCodes: [{ code: 'CARDIO', label: 'Cardiology' }],
      enabledConditionCodes: [{ code: 'STABLE', label: 'Stable' }],
      relationships: EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS,
    });
    expect(response.organizationConfigVersion).toBe(4);
    expect(response.organizationConfigStatus).toBe(OrgConfigStatus.ACTIVE);
  });

  describe('getOrganizationConfig', () => {
    it('returns enriched ACTIVE config with code+label values', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v4',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 4,
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        enabledCategoryCodes: ['CARDIOLOGY'],
        enabledConditionCodes: ['HYPERTENSION'],
        status: OrgConfigStatus.ACTIVE,
        orgCapabilities: ['CAP-CARDIOLOGY__HYPERTENSION'],
        publishedAt: 1_700_000_000_000,
        publishedBy: 'user-1',
        createdAt: 1,
        updatedAt: 1,
      });
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({
        items: [
          {
            metadataType: 'Country',
            displayName: 'Country',
            multiSelectAllowed: false,
            valueDataType: 'string',
            values: [{ valueCode: 'IN', label: 'India', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
          },
          {
            metadataType: 'State',
            displayName: 'State',
            multiSelectAllowed: false,
            valueDataType: 'string',
            values: [{ valueCode: 'KA', label: 'Karnataka', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
          },
          {
            metadataType: 'Category',
            displayName: 'Category',
            multiSelectAllowed: true,
            valueDataType: 'string',
            values: [{ valueCode: 'CARDIOLOGY', label: 'Cardiology', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
          },
          {
            metadataType: 'Condition',
            displayName: 'Condition',
            multiSelectAllowed: true,
            valueDataType: 'string',
            values: [{ valueCode: 'HYPERTENSION', label: 'Hypertension', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
          },
          {
            metadataType: 'Department',
            displayName: 'Department',
            multiSelectAllowed: true,
            valueDataType: 'Enum',
            values: [{ valueCode: 'CARDIO_DEPT', label: 'Cardiology Dept', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
          },
          {
            metadataType: 'ProgramType',
            displayName: 'Program Type',
            multiSelectAllowed: true,
            valueDataType: 'Enum',
            values: [],
          },
          {
            metadataType: 'Specialty',
            displayName: 'Specialty',
            multiSelectAllowed: true,
            valueDataType: 'Enum',
            values: [{ valueCode: 'CARDIOLOGY', label: 'Cardiology', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }],
          },
        ],
        missingMetadataTypeCodes: [],
      });
      metadataRegistryClient.getRelatedValues.mockImplementation(async (params) => {
        if (params.fromType === 'Category') {
          return {
            groups: [
              {
                fromMetadataTypeCode: 'Category',
                fromMetadataValueCode: 'CARDIOLOGY',
                fromLabel: 'Cardiology',
                values: [{ metadataTypeCode: 'Condition', metadataValueCode: 'HYPERTENSION', label: 'Hypertension' }],
              },
            ],
          };
        }
        if (params.fromType === 'Country') {
          return {
            groups: [
              {
                fromMetadataTypeCode: 'Country',
                fromMetadataValueCode: 'IN',
                fromLabel: 'India',
                values: [{ metadataTypeCode: 'State', metadataValueCode: 'KA', label: 'Karnataka' }],
              },
            ],
          };
        }
        return { groups: [] };
      });

      const response = await service.getOrganizationConfig('org-1', 'Bearer token');

      expect(response).toEqual({
        organizationId: 'org-1',
        organizationConfigVersion: 4,
        organizationConfigStatus: OrgConfigStatus.ACTIVE,
        metadataTypeMapping: ORG_CONFIG_METADATA_TYPE_MAPPING,
        organizationConfig: {
          enabledCountryCodes: [{ code: 'IN', label: 'India' }],
          enabledStateCodes: [{ code: 'KA', label: 'Karnataka' }],
          enabledCategoryCodes: [{ code: 'CARDIOLOGY', label: 'Cardiology' }],
          enabledConditionCodes: [{ code: 'HYPERTENSION', label: 'Hypertension' }],
          relationships: {
            categoryConditionGroups: [
              {
                category: { code: 'CARDIOLOGY', label: 'Cardiology' },
                conditions: [{ code: 'HYPERTENSION', label: 'Hypertension' }],
              },
            ],
            countryStateGroups: [
              {
                country: { code: 'IN', label: 'India' },
                states: [{ code: 'KA', label: 'Karnataka' }],
              },
            ],
            stateCityGroups: [],
          },
        },
        orgCapabilities: ['CAP-CARDIOLOGY__HYPERTENSION'],
        publishedAt: new Date(1_700_000_000_000).toISOString(),
        publishedBy: 'user-1',
      });
      expect(response.metadataTypeMapping.Country).toEqual(['enabledCountryCodes']);
      expect(response.metadataTypeMapping.timezone).toBeUndefined();
      expect(response).not.toHaveProperty('metadataDefaults');
      expect(response).not.toHaveProperty('enabledCategoryConditionGroups');
      expect(response).not.toHaveProperty('countryStateCityGroup');
    });

    it('falls back to label=code when metadata registry fails', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v1',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 1,
        defaultLanguageCode: 'EN',
        status: OrgConfigStatus.ACTIVE,
        createdAt: 1,
        updatedAt: 1,
      });
      metadataRegistryClient.getValuesByTypes.mockRejectedValue(new Error('registry down'));

      const response = await service.getOrganizationConfig('org-1', 'Bearer token');

      expect(response.organizationConfig?.defaultLanguageCode).toEqual({ code: 'EN', label: 'EN' });
      expect(response.organizationConfig?.relationships).toEqual(EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS);
      expect(response.metadataTypeMapping).toEqual(ORG_CONFIG_METADATA_TYPE_MAPPING);
      expect(response).not.toHaveProperty('metadataDefaults');
    });

    it('maps legacy supported* config into enriched response', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v2',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 2,
        supportedCountries: ['IN'],
        supportedLanguages: ['en'],
        supportedStates: ['KA'],
        supportedCategories: ['CARDIO'],
        supportedConditions: ['STABLE'],
        status: OrgConfigStatus.ACTIVE,
        createdAt: 1,
        updatedAt: 1,
      });
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({ items: [], missingMetadataTypeCodes: [] });
      metadataRegistryClient.getRelatedValues.mockResolvedValue({ groups: [] });

      const response = await service.getOrganizationConfig('org-1', 'Bearer token');

      expect(response.organizationConfig).toEqual({
        enabledCountryCodes: [{ code: 'IN', label: 'IN' }],
        enabledStateCodes: [{ code: 'KA', label: 'KA' }],
        defaultLanguageCode: { code: 'EN', label: 'EN' },
        supportedLanguageCodes: [{ code: 'EN', label: 'EN' }],
        enabledCategoryCodes: [{ code: 'CARDIO', label: 'CARDIO' }],
        enabledConditionCodes: [{ code: 'STABLE', label: 'STABLE' }],
        relationships: EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS,
      });
      expect(response.metadataTypeMapping).toEqual(ORG_CONFIG_METADATA_TYPE_MAPPING);
      expect(response).not.toHaveProperty('metadataDefaults');
    });

    it('returns metadataTypeMapping when org exists but has no config record', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue(null);

      const response = await service.getOrganizationConfig('org-1', 'Bearer token');

      expect(response).toEqual({
        organizationId: 'org-1',
        metadataTypeMapping: ORG_CONFIG_METADATA_TYPE_MAPPING,
      });
      expect(response).not.toHaveProperty('metadataDefaults');
      expect(response).not.toHaveProperty('organizationConfig');
    });

    it('returns only organizationId when no config record exists', async () => {
      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue(null);

      const response = await service.getOrganizationConfig('org-1');

      expect(response).toEqual({
        organizationId: 'org-1',
        metadataTypeMapping: ORG_CONFIG_METADATA_TYPE_MAPPING,
      });
    });

    it('throws OrganizationNotFoundError when org does not exist', async () => {
      repository.getOrganization.mockResolvedValue(null);

      await expect(service.getOrganizationConfig('missing-org')).rejects.toThrow(/missing-org/);
      expect(repository.getActiveOrganizationConfigItem).not.toHaveBeenCalled();
    });

    it('returns all saved metadata-backed config fields enriched on GET', async () => {
      const fullStoredConfig = {
        pk: 'ORG#org-1',
        sk: 'CONFIG#v5',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 5,
        status: OrgConfigStatus.ACTIVE,
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        enabledCityCodes: ['BLR'],
        timezone: 'Asia/Kolkata',
        defaultLanguageCode: 'EN',
        supportedLanguageCodes: ['EN', 'HI'],
        enabledCategoryCodes: ['CAT_A'],
        enabledConditionCodes: ['COND_A'],
        enabledSpecialtyCodes: ['SPEC_A'],
        enabledDeviceCodes: ['DEV_A'],
        enabledVitalCodes: ['VITAL_BP'],
        enabledMetricCodes: ['METRIC_CHECKIN'],
        enabledReminderChannels: ['SMS'],
        enabledRoleTypes: ['NURSE'],
        requiredDocumentTypes: ['DOC_ID'],
        requiredAgreementTypes: ['AGR_TERMS'],
        currencyCode: 'INR',
        paymentModeCodes: ['CARD'],
        enabledModuleCodes: ['MOD_A'],
        enabledFeatureCodes: ['FEAT_A'],
        linkedOrgReferences: ['org-2'],
        requiredAgreementIds: ['agr-1'],
        createdAt: 1,
        updatedAt: 1,
      };

      repository.getOrganization.mockResolvedValue({
        organizationId: 'org-1',
        name: 'Org 1',
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue(fullStoredConfig);
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({
        items: [
          { metadataType: 'Country', displayName: 'Country', multiSelectAllowed: false, valueDataType: 'string', values: [{ valueCode: 'IN', label: 'India', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'State', displayName: 'State', multiSelectAllowed: false, valueDataType: 'string', values: [{ valueCode: 'KA', label: 'Karnataka', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'City', displayName: 'City', multiSelectAllowed: false, valueDataType: 'string', values: [{ valueCode: 'BLR', label: 'Bengaluru', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Language', displayName: 'Language', multiSelectAllowed: false, valueDataType: 'string', values: [{ valueCode: 'EN', label: 'English', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }, { valueCode: 'HI', label: 'Hindi', status: 'active', isGlobal: true, sortOrder: 2, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Category', displayName: 'Category', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'CAT_A', label: 'Category A', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Condition', displayName: 'Condition', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'COND_A', label: 'Condition A', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Specialty', displayName: 'Specialty', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'SPEC_A', label: 'Specialty A', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Device', displayName: 'Device', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'DEV_A', label: 'Device A', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Vital', displayName: 'Vital', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'VITAL_BP', label: 'Blood Pressure', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'MetricCode', displayName: 'Metric', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'METRIC_CHECKIN', label: 'Check-in', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'ReminderChannel', displayName: 'Reminder Channel', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'SMS', label: 'SMS', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'RoleType', displayName: 'Role Type', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'NURSE', label: 'Nurse', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'DocumentType', displayName: 'Document Type', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'DOC_ID', label: 'ID Document', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'AgreementType', displayName: 'Agreement Type', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'AGR_TERMS', label: 'Terms', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Currency', displayName: 'Currency', multiSelectAllowed: false, valueDataType: 'string', values: [{ valueCode: 'INR', label: 'Indian Rupee', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'PaymentMode', displayName: 'Payment Mode', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'CARD', label: 'Card', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'ApplicableModule', displayName: 'Module', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'MOD_A', label: 'Module A', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
          { metadataType: 'Feature', displayName: 'Feature', multiSelectAllowed: true, valueDataType: 'string', values: [{ valueCode: 'FEAT_A', label: 'Feature A', status: 'active', isGlobal: true, sortOrder: 1, attributes: {}, applicability: { module: [], category: [], condition: [], country: [], language: [] } }] },
        ],
        missingMetadataTypeCodes: [],
      });
      metadataRegistryClient.getRelatedValues.mockResolvedValue({ groups: [] });

      const response = await service.getOrganizationConfig('org-1', 'Bearer token');

      expect(response.metadataTypeMapping).toEqual(ORG_CONFIG_METADATA_TYPE_MAPPING);
      expect(response.organizationConfig?.enabledCountryCodes).toEqual([{ code: 'IN', label: 'India' }]);
      expect(response.organizationConfig?.enabledStateCodes).toEqual([{ code: 'KA', label: 'Karnataka' }]);
      expect(response.organizationConfig?.enabledCityCodes).toEqual([{ code: 'BLR', label: 'Bengaluru' }]);
      expect(response.organizationConfig?.enabledCategoryCodes).toEqual([{ code: 'CAT_A', label: 'Category A' }]);
      expect(response.organizationConfig?.enabledConditionCodes).toEqual([{ code: 'COND_A', label: 'Condition A' }]);
      expect(response.organizationConfig?.defaultLanguageCode).toEqual({ code: 'EN', label: 'English' });
      expect(response.organizationConfig?.supportedLanguageCodes).toEqual([
        { code: 'EN', label: 'English' },
        { code: 'HI', label: 'Hindi' },
      ]);
      expect(response.organizationConfig?.timezone).toBe('Asia/Kolkata');
      expect(response.organizationConfig?.currencyCode).toEqual({ code: 'INR', label: 'Indian Rupee' });
      expect(response.organizationConfig?.linkedOrgReferences).toEqual(['org-2']);
      expect(response.organizationConfig?.requiredAgreementIds).toEqual(['agr-1']);
      expect(response.organizationConfig?.relationships).toEqual(EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS);
    });
  });

  describe('saveOrganizationConfig', () => {
    const sampleConfig = {
      enabledCountryCodes: ['IN'],
      enabledStateCodes: ['KA'],
      enabledCityCodes: ['BLR'],
      timezone: 'Asia/Kolkata',
      defaultLanguageCode: 'en',
      supportedLanguageCodes: ['en', 'hi'],
      enabledCategoryCodes: ['CAT_A'],
      enabledConditionCodes: ['COND_A'],
      enabledSpecialtyCodes: ['SPEC_A'],
      enabledDeviceCodes: ['DEV_A'],
      enabledVitalCodes: ['VITAL_BP'],
      enabledMetricCodes: ['METRIC_CHECKIN'],
      enabledReminderChannels: ['SMS'],
      enabledRoleTypes: ['NURSE'],
      requiredDocumentTypes: ['DOC_ID'],
      requiredAgreementTypes: ['AGR_TERMS'],
      currencyCode: 'INR',
      paymentModeCodes: ['CARD'],
      enabledModuleCodes: ['MOD_A'],
      enabledFeatureCodes: ['FEAT_A'],
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
      expect(result.organizationConfigVersion).toBe(1);
      expect(result.status).toBe(OrgConfigStatus.DRAFT);
      expect(result.config).toEqual(sampleConfig);
    });

    it('creates the next draft version when config changed', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue({
        version: 2,
        status: OrgConfigStatus.DRAFT,
        enabledCountryCodes: ['IN'],
        supportedLanguageCodes: ['en'],
      });
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 3,
        status: OrgConfigStatus.DRAFT,
      });

      const result = await service.saveOrganizationConfig(
        'org-1',
        { enabledCountryCodes: ['US'], changeReason: 'switch country' },
        'corr-1',
        'user-1',
      );

      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith(
        'org-1',
        { enabledCountryCodes: ['US'], supportedLanguageCodes: ['en'] },
        { changeReason: 'switch country', createdBy: 'user-1' },
      );
      expect(result.organizationConfigVersion).toBe(3);
      expect(result.config).toEqual({ enabledCountryCodes: ['US'], supportedLanguageCodes: ['en'] });
    });

    it('merges incoming patch with latest config before saving', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
        enabledCountryCodes: ['IN'],
        enabledCategoryCodes: ['CAT_A'],
      });
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 2,
        status: OrgConfigStatus.DRAFT,
      });

      await service.saveOrganizationConfig('org-1', { enabledConditionCodes: ['COND_A'] }, 'corr-1', 'user-1');

      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith(
        'org-1',
        {
          enabledCountryCodes: ['IN'],
          enabledCategoryCodes: ['CAT_A'],
          enabledConditionCodes: ['COND_A'],
        },
        { changeReason: undefined, createdBy: 'user-1' },
      );
    });

    it('does not create a new version when merged config matches the latest', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue({
        version: 5,
        status: OrgConfigStatus.ACTIVE,
        ...sampleConfig,
      });

      const result = await service.saveOrganizationConfig('org-1', { enabledCountryCodes: ['IN'] }, 'corr-1', 'user-1');

      expect(repository.createOrganizationConfigDraftVersion).not.toHaveBeenCalled();
      expect(result.organizationConfigVersion).toBe(5);
      expect(result.status).toBe(OrgConfigStatus.ACTIVE);
      expect(result.config).toEqual(sampleConfig);
    });

    it('persists new org config fields on draft creation', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue(null);
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
      });

      const newFieldsConfig = {
        enabledStateCodes: ['KA'],
        enabledCityCodes: ['BLR'],
        enabledSpecialtyCodes: ['SPEC_A'],
        enabledVitalCodes: ['VITAL_BP'],
        enabledReminderChannels: ['SMS'],
        enabledRoleTypes: ['NURSE'],
        requiredDocumentTypes: ['DOC_ID'],
        requiredAgreementTypes: ['AGR_TERMS'],
        currencyCode: 'INR',
        paymentModeCodes: ['CARD'],
      };

      const result = await service.saveOrganizationConfig('org-1', newFieldsConfig, 'corr-1', 'user-1');

      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith(
        'org-1',
        newFieldsConfig,
        { changeReason: undefined, createdBy: 'user-1' },
      );
      expect(result.config).toEqual(newFieldsConfig);
    });

    it('normalizes and persists enabledCountryCodes on draft creation', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue(null);
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
      });

      await service.saveOrganizationConfig(
        'org-1',
        { enabledCountryCodes: ['in', ' US ', 'AE', 'US'] },
        'corr-1',
        'user-1',
      );

      expect(repository.createOrganizationConfigDraftVersion).toHaveBeenCalledWith(
        'org-1',
        { enabledCountryCodes: ['IN', 'US', 'AE'] },
        { changeReason: undefined, createdBy: 'user-1' },
      );
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

  describe('publishOrganizationConfig', () => {
    const draftConfig = {
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

    const activeConfig = {
      pk: 'ORG#org-1',
      sk: 'CONFIG#v4',
      entityType: OrgConfigEntityType.ORG_CONFIG,
      orgId: 'org-1',
      version: 4,
      status: OrgConfigStatus.ACTIVE,
      enabledCategoryCodes: ['CHRONIC'],
      enabledConditionCodes: ['DIABETES'],
      createdAt: 1,
      updatedAt: 1,
    };

    const metadataSuccessMocks = () => {
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({
        items: [
          {
            metadataType: 'Category',
            values: [{ valueCode: 'CHRONIC', status: 'active' }],
          },
          {
            metadataType: 'Condition',
            values: [{ valueCode: 'HYPERTENSION', status: 'active' }],
          },
        ],
        missingMetadataTypeCodes: [],
      });
      metadataRegistryClient.getRelatedValues.mockResolvedValue({
        groups: [
          {
            fromMetadataValueCode: 'CHRONIC',
            values: [{ metadataValueCode: 'HYPERTENSION' }],
          },
        ],
      });
    };

    it('validates metadata, activates draft, builds orgCapabilities, and emits event', async () => {
      metadataSuccessMocks();
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestDraftOrganizationConfig.mockResolvedValue(draftConfig);
      repository.getActiveOrganizationConfigItem.mockResolvedValue(activeConfig);
      repository.publishOrganizationConfigVersion.mockResolvedValue({
        ...draftConfig,
        status: OrgConfigStatus.ACTIVE,
        orgCapabilities: ['CAP-CHRONIC__HYPERTENSION'],
        changedSections: ['enabledConditionCodes'],
        changeType: ORG_CONFIG_CHANGE_TYPE.UPDATE,
      });

      const result = await service.publishOrganizationConfig('org-1', {
        authHeader: 'Bearer token',
        publishedBy: 'user-1',
        correlationId: 'corr-1',
      });

      expect(result.status).toBe(OrgConfigStatus.ACTIVE);
      expect(result.organizationConfigVersion).toBe(5);
      expect(result.orgCapabilities).toEqual(['CAP-CHRONIC__HYPERTENSION']);
      expect(repository.publishOrganizationConfigVersion).toHaveBeenCalledWith(
        'org-1',
        5,
        expect.objectContaining({
          orgCapabilities: ['CAP-CHRONIC__HYPERTENSION'],
          changeType: ORG_CONFIG_CHANGE_TYPE.UPDATE,
        }),
      );
      expect(mockPublishOrgConfigPublishedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          orgConfigVersion: 5,
          changeType: ORG_CONFIG_CHANGE_TYPE.UPDATE,
        }),
        { organizationId: 'org-1', correlationId: 'corr-1' },
      );
    });

    it('does not activate or emit when metadata validation fails', async () => {
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({
        items: [
          {
            metadataType: 'Condition',
            values: [{ valueCode: 'HYPERTENSION', status: 'active' }],
          },
        ],
        missingMetadataTypeCodes: [],
      });

      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestDraftOrganizationConfig.mockResolvedValue({
        ...draftConfig,
        enabledCategoryCodes: undefined,
        enabledConditionCodes: ['HYPERTENSION_XYZ'],
      });

      await expect(
        service.publishOrganizationConfig('org-1', { authHeader: 'Bearer token' }),
      ).rejects.toMatchObject({ code: 'INVALID_METADATA_VALUE' });

      expect(repository.publishOrganizationConfigVersion).not.toHaveBeenCalled();
      expect(mockPublishOrgConfigPublishedEvent).not.toHaveBeenCalled();
    });

    it('does not activate or emit when relation validation fails', async () => {
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({
        items: [
          {
            metadataType: 'Category',
            values: [{ valueCode: 'DIABETES', status: 'active' }],
          },
          {
            metadataType: 'Condition',
            values: [{ valueCode: 'HYPERTENSION', status: 'active' }],
          },
        ],
        missingMetadataTypeCodes: [],
      });
      metadataRegistryClient.getRelatedValues.mockResolvedValue({
        groups: [
          {
            fromMetadataValueCode: 'DIABETES',
            values: [{ metadataValueCode: 'TYPE2' }],
          },
        ],
      });

      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestDraftOrganizationConfig.mockResolvedValue({
        ...draftConfig,
        enabledCategoryCodes: ['DIABETES'],
        enabledConditionCodes: ['HYPERTENSION'],
      });

      await expect(
        service.publishOrganizationConfig('org-1', { authHeader: 'Bearer token' }),
      ).rejects.toMatchObject({ code: 'INVALID_METADATA_RELATION' });

      expect(repository.publishOrganizationConfigVersion).not.toHaveBeenCalled();
      expect(mockPublishOrgConfigPublishedEvent).not.toHaveBeenCalled();
    });

    it('throws ORG_CONFIG_PUBLISH_FAILED when event emission fails after activation', async () => {
      mockPublishOrgConfigPublishedEvent.mockRejectedValueOnce(new Error('bus down'));

      metadataSuccessMocks();
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestDraftOrganizationConfig.mockResolvedValue(draftConfig);
      repository.getActiveOrganizationConfigItem.mockResolvedValue(null);
      repository.publishOrganizationConfigVersion.mockResolvedValue({
        ...draftConfig,
        status: OrgConfigStatus.ACTIVE,
        orgCapabilities: ['CAP-CHRONIC__HYPERTENSION'],
      });

      await expect(
        service.publishOrganizationConfig('org-1', { authHeader: 'Bearer token' }),
      ).rejects.toBeInstanceOf(OrgConfigPublishError);

      expect(repository.publishOrganizationConfigVersion).toHaveBeenCalled();
    });
  });

  describe('saveAndPublishOrganizationConfig', () => {
    const sampleConfig = {
      enabledCountryCodes: ['IN'],
      enabledCategoryCodes: ['CHRONIC'],
      enabledConditionCodes: ['HYPERTENSION'],
    };

    it('auto-publishes after saving draft and returns ACTIVE version', async () => {
      metadataRegistryClient.getValuesByTypes.mockResolvedValue({
        items: [
          {
            metadataType: 'Country',
            values: [{ valueCode: 'IN', status: 'active' }],
          },
          {
            metadataType: 'Category',
            values: [{ valueCode: 'CHRONIC', status: 'active' }],
          },
          {
            metadataType: 'Condition',
            values: [{ valueCode: 'HYPERTENSION', status: 'active' }],
          },
        ],
        missingMetadataTypeCodes: [],
      });
      metadataRegistryClient.getRelatedValues.mockResolvedValue({
        groups: [
          {
            fromMetadataValueCode: 'CHRONIC',
            values: [{ metadataValueCode: 'HYPERTENSION' }],
          },
        ],
      });

      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue(null);
      repository.createOrganizationConfigDraftVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.DRAFT,
      });
      repository.getOrganizationConfigByVersion.mockResolvedValue({
        pk: 'ORG#org-1',
        sk: 'CONFIG#v1',
        entityType: OrgConfigEntityType.ORG_CONFIG,
        orgId: 'org-1',
        version: 1,
        status: OrgConfigStatus.DRAFT,
        ...sampleConfig,
        createdAt: 1,
        updatedAt: 1,
      });
      repository.getActiveOrganizationConfigItem.mockResolvedValue(null);
      repository.publishOrganizationConfigVersion.mockResolvedValue({
        version: 1,
        status: OrgConfigStatus.ACTIVE,
        orgCapabilities: ['CAP-CHRONIC__HYPERTENSION'],
      });

      const result = await service.saveAndPublishOrganizationConfig('org-1', sampleConfig, {
        authHeader: 'Bearer token',
        correlationId: 'corr-1',
        createdBy: 'user-1',
      });

      expect(result.status).toBe(OrgConfigStatus.ACTIVE);
      expect(result.organizationConfigVersion).toBe(1);
      expect(result.orgCapabilities).toEqual(['CAP-CHRONIC__HYPERTENSION']);
    });

    it('skips publish when config is unchanged and already ACTIVE', async () => {
      repository.getOrganization.mockResolvedValue({ organizationId: 'org-1', name: 'Org 1' });
      repository.getLatestOrganizationConfigVersionItem.mockResolvedValue({
        version: 2,
        status: OrgConfigStatus.ACTIVE,
        ...sampleConfig,
      });

      const result = await service.saveAndPublishOrganizationConfig('org-1', { enabledCountryCodes: ['IN'] }, {
        authHeader: 'Bearer token',
      });

      expect(result.status).toBe(OrgConfigStatus.ACTIVE);
      expect(result.organizationConfigVersion).toBe(2);
      expect(repository.publishOrganizationConfigVersion).not.toHaveBeenCalled();
      expect(mockPublishOrgConfigPublishedEvent).not.toHaveBeenCalled();
    });
  });
});
