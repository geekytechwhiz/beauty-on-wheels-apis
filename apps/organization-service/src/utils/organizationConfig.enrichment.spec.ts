import { describe, expect, it, jest } from '@jest/globals';

import type { OrgConfigMetadataReader } from './organizationConfig.validator';
import {
  buildMetadataLabelLookup,
  deriveCategoryConditionGroups,
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
    );
    expect(enriched.enabledCountryCodes).toEqual([{ code: 'IN', label: 'India' }]);
    expect(enriched.enabledStateCodes).toEqual([{ code: 'KA', label: 'Karnataka' }]);
    expect(enriched.enabledCityCodes).toEqual([{ code: 'BLR', label: 'Bengaluru' }]);
  });

  it('returns code+label arrays for enabledCountryCodes', () => {
    const lookup = buildMetadataLabelLookup({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: true,
          valueDataType: 'string',
          values: [
            registryValue('IN', 'India'),
            registryValue('US', 'United States'),
            registryValue('AE', 'United Arab Emirates'),
          ],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    const enriched = enrichOrganizationConfigFields(
      { enabledCountryCodes: ['IN', 'US', 'AE'] },
      lookup,
    );
    expect(enriched.enabledCountryCodes).toEqual([
      { code: 'IN', label: 'India' },
      { code: 'US', label: 'United States' },
      { code: 'AE', label: 'United Arab Emirates' },
    ]);
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

    const enriched = enrichOrganizationConfigFields({ enabledCategoryCodes: ['CARDIOLOGY'] }, lookup);
    expect(enriched.enabledCategoryCodes).toEqual([{ code: 'CARDIOLOGY', label: 'Cardiology' }]);
  });

  it('falls back to label=code when metadata is missing', () => {
    const enriched = enrichOrganizationConfigFields(
      { defaultLanguageCode: 'XX' },
      new Map(),
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
    expect(result.enabledCategoryConditionGroups).toBeUndefined();
    expect(result.metadataDefaults).toBeUndefined();
  });

  it('includes metadataDefaults from a single registry batch read', async () => {
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
            metadataType: 'Specialty',
            displayName: 'Specialty',
            multiSelectAllowed: true,
            valueDataType: 'Enum',
            values: [registryValue('CARDIOLOGY', 'Cardiology')],
          },
          {
            metadataType: 'Department',
            displayName: 'Department',
            multiSelectAllowed: true,
            valueDataType: 'Enum',
            values: [],
          },
          {
            metadataType: 'ProgramType',
            displayName: 'Program Type',
            multiSelectAllowed: true,
            valueDataType: 'Enum',
            values: [],
          },
        ],
        missingMetadataTypeCodes: [],
      }),
      getRelatedValues: jest.fn<GetRelatedValues>(),
    };

    const result = await enrichOrganizationConfig(
      { enabledCountryCodes: ['IN'] },
      { authHeader: 'Bearer token', reader },
    );

    expect(reader.getValuesByTypes).toHaveBeenCalledWith(
      expect.arrayContaining(['Country', 'Department', 'ProgramType', 'Specialty']),
      'Bearer token',
    );
    expect(result.metadataDefaults).toEqual({
      department: [],
      programType: [],
      specialty: [{ valueCode: 'CARDIOLOGY', label: 'Cardiology' }],
    });
  });

  it('derives category->condition groups from relations intersected with enabled conditions', async () => {
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
        ],
      }),
    };

    const result = await enrichOrganizationConfig(
      {
        enabledCategoryCodes: ['CARDIOLOGY'],
        enabledConditionCodes: ['HYPERTENSION'],
      },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.enabledCategoryConditionGroups).toEqual([
      {
        category: { code: 'CARDIOLOGY', label: 'Cardiology' },
        conditions: [{ code: 'HYPERTENSION', label: 'Hypertension' }],
      },
    ]);
  });

  it('builds countryStateCityGroup from enabled location arrays', async () => {
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
        ],
        missingMetadataTypeCodes: [],
      }),
      getRelatedValues: jest.fn<GetRelatedValues>(),
    };

    const result = await enrichOrganizationConfig(
      { enabledCountryCodes: ['IN'], enabledStateCodes: ['KA'] },
      { authHeader: 'Bearer token', reader },
    );

    expect(result.countryStateCityGroup).toEqual({
      countries: [{ code: 'IN', label: 'India' }],
      states: [{ code: 'KA', label: 'Karnataka' }],
    });
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
