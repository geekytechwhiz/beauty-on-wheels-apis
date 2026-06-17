import { describe, expect, it, jest } from '@jest/globals';

import type { OrgConfigMetadataReader } from './organizationConfig.validator';
import {
  buildMetadataLabelLookup,
  deriveCategoryConditionGroups,
  deriveCountryStateGroups,
  deriveStateCityGroups,
  EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS,
  enrichOrganizationConfig,
  enrichOrganizationConfigFields,
  toMetadataCodeLabel,
} from './organizationConfig.enrichment';

type GetValuesByTypes = OrgConfigMetadataReader['getValuesByTypes'];
type GetRelatedValues = OrgConfigMetadataReader['getRelatedValues'];
type MetadataValuesByTypesResultDto = Awaited<ReturnType<GetValuesByTypes>>;
type MetadataRelatedValuesResultDto = Awaited<ReturnType<GetRelatedValues>>;

const registryValue = (valueCode: string, label: string) => ({
  valueCode,
  label,
  status: 'active',
  isGlobal: true,
  sortOrder: 1,
  attributes: {},
  applicability: { module: [], category: [], condition: [], country: [], language: [] },
});

const mockGetValuesByTypes = (result: MetadataValuesByTypesResultDto) =>
  jest.fn<GetValuesByTypes>().mockResolvedValue(result);

const mockGetRelatedValues = (result: MetadataRelatedValuesResultDto) =>
  jest.fn<GetRelatedValues>().mockResolvedValue(result);

const emptyRelationships = () => ({ ...EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS });

describe('organizationConfig.enrichment', () => {
  it('returns code+label arrays for enabled location fields', () => {
    const lookup = buildMetadataLabelLookup({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [registryValue('IN', 'India')],
        },
        {
          metadataType: 'State',
          displayName: 'State',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [registryValue('KA', 'Karnataka')],
        },
        {
          metadataType: 'City',
          displayName: 'City',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [registryValue('BLR', 'Bengaluru')],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    const enriched = enrichOrganizationConfigFields(
      {
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        enabledCityCodes: ['BLR'],
      },
      lookup,
      emptyRelationships(),
    );
    expect(enriched.enabledCountryCodes).toEqual([{ code: 'IN', label: 'India' }]);
    expect(enriched.enabledStateCodes).toEqual([{ code: 'KA', label: 'Karnataka' }]);
    expect(enriched.enabledCityCodes).toEqual([{ code: 'BLR', label: 'Bengaluru' }]);
    expect(enriched.relationships).toEqual(emptyRelationships());
  });

  it('returns code+label arrays for multi-value fields', () => {
    const lookup = buildMetadataLabelLookup({
      items: [
        {
          metadataType: 'Category',
          displayName: 'Category',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [registryValue('CARDIOLOGY', 'Cardiology')],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    const enriched = enrichOrganizationConfigFields(
      { enabledCategoryCodes: ['CARDIOLOGY'] },
      lookup,
      emptyRelationships(),
    );
    expect(enriched.enabledCategoryCodes).toEqual([{ code: 'CARDIOLOGY', label: 'Cardiology' }]);
  });

  it('returns a single object for single-value fields', () => {
    const lookup = buildMetadataLabelLookup({
      items: [
        {
          metadataType: 'Language',
          displayName: 'Language',
          multiSelectAllowed: false,
          valueDataType: 'string',
          values: [registryValue('EN', 'English')],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    const enriched = enrichOrganizationConfigFields(
      { defaultLanguageCode: 'EN' },
      lookup,
      emptyRelationships(),
    );
    expect(enriched.defaultLanguageCode).toEqual({ code: 'EN', label: 'English' });
  });

  it('falls back to label=code when metadata is missing', () => {
    const enriched = enrichOrganizationConfigFields(
      { defaultLanguageCode: 'XX' },
      new Map(),
      emptyRelationships(),
    );
    expect(enriched.defaultLanguageCode).toEqual({ code: 'XX', label: 'XX' });
  });

  it('does not fail when metadata registry lookup fails', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: jest.fn<GetValuesByTypes>().mockRejectedValue(new Error('registry down')),
      getRelatedValues: jest.fn<GetRelatedValues>(),
    };

    const result = await enrichOrganizationConfig(
      { enabledCountryCodes: ['IN'], enabledCategoryCodes: ['CARDIOLOGY'] },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.organizationConfig.enabledCountryCodes).toEqual([{ code: 'IN', label: 'IN' }]);
    expect(result.organizationConfig.enabledCategoryCodes).toEqual([
      { code: 'CARDIOLOGY', label: 'CARDIOLOGY' },
    ]);
    expect(result.organizationConfig.relationships).toEqual(emptyRelationships());
  });

  it('always returns organizationConfig.relationships with empty arrays when relation inputs are missing', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: mockGetValuesByTypes({ items: [], missingMetadataTypeCodes: [] }),
      getRelatedValues: jest.fn<GetRelatedValues>(),
    };

    const result = await enrichOrganizationConfig(
      { enabledCountryCodes: ['IN'] },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.organizationConfig.relationships).toEqual(emptyRelationships());
    expect(reader.getRelatedValues).not.toHaveBeenCalled();
  });

  it('derives category->condition groups intersected with enabled conditions', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: mockGetValuesByTypes({
        items: [
          {
            metadataType: 'Category',
            displayName: 'Category',
            multiSelectAllowed: true,
            valueDataType: 'string',
            values: [
              registryValue('CARDIOLOGY', 'Cardiology'),
              registryValue('NEUROLOGY', 'Neurology'),
            ],
          },
          {
            metadataType: 'Condition',
            displayName: 'Condition',
            multiSelectAllowed: true,
            valueDataType: 'string',
            values: [registryValue('HYPERTENSION', 'Hypertension')],
          },
        ],
        missingMetadataTypeCodes: [],
      }),
      getRelatedValues: mockGetRelatedValues({
        groups: [
          {
            fromMetadataTypeCode: 'Category',
            fromMetadataValueCode: 'CARDIOLOGY',
            fromLabel: 'Cardiology',
            values: [
              {
                metadataTypeCode: 'Condition',
                metadataValueCode: 'HYPERTENSION',
                label: 'Hypertension',
              },
              {
                metadataTypeCode: 'Condition',
                metadataValueCode: 'DIABETES',
                label: 'Diabetes',
              },
            ],
          },
          {
            fromMetadataTypeCode: 'Category',
            fromMetadataValueCode: 'NEUROLOGY',
            fromLabel: 'Neurology',
            values: [
              {
                metadataTypeCode: 'Condition',
                metadataValueCode: 'MIGRAINE',
                label: 'Migraine',
              },
            ],
          },
        ],
      }),
    };

    const result = await enrichOrganizationConfig(
      {
        enabledCategoryCodes: ['CARDIOLOGY', 'NEUROLOGY'],
        enabledConditionCodes: ['HYPERTENSION'],
      },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.organizationConfig.enabledCategoryCodes).toEqual([
      { code: 'CARDIOLOGY', label: 'Cardiology' },
      { code: 'NEUROLOGY', label: 'Neurology' },
    ]);
    expect(result.organizationConfig.relationships.categoryConditionGroups).toEqual([
      {
        category: { code: 'CARDIOLOGY', label: 'Cardiology' },
        conditions: [{ code: 'HYPERTENSION', label: 'Hypertension' }],
      },
    ]);
  });

  it('builds countryStateGroups and stateCityGroups from relation API', async () => {
    const getRelatedValues = jest.fn<GetRelatedValues>().mockImplementation(async (params) => {
      if (params.fromType === 'Country') {
        return {
          groups: [
            {
              fromMetadataTypeCode: 'Country',
              fromMetadataValueCode: 'IN',
              fromLabel: 'India',
              values: [
                { metadataTypeCode: 'State', metadataValueCode: 'KA', label: 'Karnataka' },
                { metadataTypeCode: 'State', metadataValueCode: 'TN', label: 'Tamil Nadu' },
              ],
            },
          ],
        };
      }
      if (params.fromType === 'State') {
        return {
          groups: [
            {
              fromMetadataTypeCode: 'State',
              fromMetadataValueCode: 'KA',
              fromLabel: 'Karnataka',
              values: [
                { metadataTypeCode: 'City', metadataValueCode: 'BLR', label: 'Bengaluru' },
                { metadataTypeCode: 'City', metadataValueCode: 'MYS', label: 'Mysuru' },
              ],
            },
          ],
        };
      }
      return { groups: [] };
    });

    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: mockGetValuesByTypes({
        items: [
          {
            metadataType: 'Country',
            displayName: 'Country',
            multiSelectAllowed: false,
            valueDataType: 'string',
            values: [registryValue('IN', 'India')],
          },
          {
            metadataType: 'State',
            displayName: 'State',
            multiSelectAllowed: false,
            valueDataType: 'string',
            values: [registryValue('KA', 'Karnataka')],
          },
          {
            metadataType: 'City',
            displayName: 'City',
            multiSelectAllowed: false,
            valueDataType: 'string',
            values: [registryValue('BLR', 'Bengaluru')],
          },
        ],
        missingMetadataTypeCodes: [],
      }),
      getRelatedValues,
    };

    const result = await enrichOrganizationConfig(
      {
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        enabledCityCodes: ['BLR'],
      },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.organizationConfig.relationships.countryStateGroups).toEqual([
      {
        country: { code: 'IN', label: 'India' },
        states: [{ code: 'KA', label: 'Karnataka' }],
      },
    ]);
    expect(result.organizationConfig.relationships.stateCityGroups).toEqual([
      {
        state: { code: 'KA', label: 'Karnataka' },
        cities: [{ code: 'BLR', label: 'Bengaluru' }],
      },
    ]);
  });

  it('returns empty relationship arrays when relation API fails', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: mockGetValuesByTypes({ items: [], missingMetadataTypeCodes: [] }),
      getRelatedValues: jest.fn<GetRelatedValues>().mockRejectedValue(new Error('relation failed')),
    };

    const result = await enrichOrganizationConfig(
      {
        enabledCategoryCodes: ['CARDIOLOGY'],
        enabledConditionCodes: ['HYPERTENSION'],
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        enabledCityCodes: ['BLR'],
      },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.organizationConfig.relationships).toEqual(emptyRelationships());
  });

  it('keeps broken relation values in organizationConfig but omits them from groups', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: mockGetValuesByTypes({
        items: [
          {
            metadataType: 'Category',
            displayName: 'Category',
            multiSelectAllowed: true,
            valueDataType: 'string',
            values: [registryValue('CARDIOLOGY', 'Cardiology')],
          },
          {
            metadataType: 'Condition',
            displayName: 'Condition',
            multiSelectAllowed: true,
            valueDataType: 'string',
            values: [registryValue('ORPHAN', 'Orphan')],
          },
        ],
        missingMetadataTypeCodes: [],
      }),
      getRelatedValues: mockGetRelatedValues({ groups: [] }),
    };

    const result = await enrichOrganizationConfig(
      {
        enabledCategoryCodes: ['CARDIOLOGY'],
        enabledConditionCodes: ['ORPHAN'],
      },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.organizationConfig.enabledConditionCodes).toEqual([
      { code: 'ORPHAN', label: 'Orphan' },
    ]);
    expect(result.organizationConfig.relationships.categoryConditionGroups).toEqual([]);
  });

  it('returns all saved metadata-backed config fields enriched', () => {
    const lookup = buildMetadataLabelLookup({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: false,
          valueDataType: 'string',
          values: [registryValue('IN', 'India')],
        },
        {
          metadataType: 'State',
          displayName: 'State',
          multiSelectAllowed: false,
          valueDataType: 'string',
          values: [registryValue('KA', 'Karnataka')],
        },
        {
          metadataType: 'Category',
          displayName: 'Category',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [registryValue('CAT_A', 'Category A')],
        },
        {
          metadataType: 'Condition',
          displayName: 'Condition',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [registryValue('COND_A', 'Condition A')],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    const enriched = enrichOrganizationConfigFields(
      {
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        enabledCategoryCodes: ['CAT_A'],
        enabledConditionCodes: ['COND_A'],
        timezone: 'Asia/Kolkata',
      },
      lookup,
      emptyRelationships(),
    );

    expect(enriched.enabledCountryCodes).toEqual([{ code: 'IN', label: 'India' }]);
    expect(enriched.enabledStateCodes).toEqual([{ code: 'KA', label: 'Karnataka' }]);
    expect(enriched.enabledCategoryCodes).toEqual([{ code: 'CAT_A', label: 'Category A' }]);
    expect(enriched.enabledConditionCodes).toEqual([{ code: 'COND_A', label: 'Condition A' }]);
    expect(enriched.timezone).toBe('Asia/Kolkata');
    expect(enriched.relationships).toEqual(emptyRelationships());
  });

  it('uses related-value label fallback via toMetadataCodeLabel', () => {
    const lookup = new Map<string, Map<string, string>>();
    expect(toMetadataCodeLabel('RPM', lookup, 'ApplicableModule')).toEqual({
      code: 'RPM',
      label: 'RPM',
    });
  });
});

describe('deriveCategoryConditionGroups', () => {
  it('returns empty when relation lookup fails', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: jest.fn<GetValuesByTypes>(),
      getRelatedValues: jest.fn<GetRelatedValues>().mockRejectedValue(new Error('relation failed')),
    };

    await expect(
      deriveCategoryConditionGroups(
        { enabledCategoryCodes: ['CARDIOLOGY'], enabledConditionCodes: ['HYPERTENSION'] },
        new Map(),
        reader,
        'Bearer token',
      ),
    ).rejects.toThrow('relation failed');
  });
});

describe('deriveCountryStateGroups', () => {
  it('includes only org-enabled states', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: jest.fn<GetValuesByTypes>(),
      getRelatedValues: mockGetRelatedValues({
        groups: [
          {
            fromMetadataTypeCode: 'Country',
            fromMetadataValueCode: 'IN',
            fromLabel: 'India',
            values: [
              { metadataTypeCode: 'State', metadataValueCode: 'KA', label: 'Karnataka' },
              { metadataTypeCode: 'State', metadataValueCode: 'TN', label: 'Tamil Nadu' },
            ],
          },
        ],
      }),
    };

    const groups = await deriveCountryStateGroups(
      { enabledCountryCodes: ['IN'], enabledStateCodes: ['KA'] },
      new Map(),
      reader,
      'Bearer token',
    );

    expect(groups).toEqual([
      {
        country: { code: 'IN', label: 'India' },
        states: [{ code: 'KA', label: 'Karnataka' }],
      },
    ]);
  });
});

describe('deriveStateCityGroups', () => {
  it('includes only org-enabled cities', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: jest.fn<GetValuesByTypes>(),
      getRelatedValues: mockGetRelatedValues({
        groups: [
          {
            fromMetadataTypeCode: 'State',
            fromMetadataValueCode: 'KA',
            fromLabel: 'Karnataka',
            values: [
              { metadataTypeCode: 'City', metadataValueCode: 'BLR', label: 'Bengaluru' },
              { metadataTypeCode: 'City', metadataValueCode: 'MYS', label: 'Mysuru' },
            ],
          },
        ],
      }),
    };

    const groups = await deriveStateCityGroups(
      { enabledStateCodes: ['KA'], enabledCityCodes: ['BLR'] },
      new Map(),
      reader,
      'Bearer token',
    );

    expect(groups).toEqual([
      {
        state: { code: 'KA', label: 'Karnataka' },
        cities: [{ code: 'BLR', label: 'Bengaluru' }],
      },
    ]);
  });
});
