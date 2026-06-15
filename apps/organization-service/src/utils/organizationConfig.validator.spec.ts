import { describe, expect, it, jest } from '@jest/globals';

import {
  computeChangedConfigSections,
  validateOrganizationConfigForPublish,
  type OrgConfigMetadataReader,
} from './organizationConfig.validator';

type GetValuesByTypes = OrgConfigMetadataReader['getValuesByTypes'];
type GetRelatedValues = OrgConfigMetadataReader['getRelatedValues'];
type MetadataValuesByTypesResultDto = Awaited<ReturnType<GetValuesByTypes>>;
type MetadataRelatedValuesResultDto = Awaited<ReturnType<GetRelatedValues>>;

const activeValue = (valueCode: string) => ({
  valueCode,
  status: 'active',
});

const defaultValuesByTypesResult: MetadataValuesByTypesResultDto = {
  items: [
    {
      metadataType: 'Country',
      values: [activeValue('IN')],
    },
    {
      metadataType: 'State',
      values: [activeValue('KA')],
    },
    {
      metadataType: 'Category',
      values: [activeValue('CARDIOLOGY')],
    },
    {
      metadataType: 'Condition',
      values: [activeValue('HYPERTENSION')],
    },
  ],
  missingMetadataTypeCodes: [],
} as MetadataValuesByTypesResultDto;

const mockGetValuesByTypes = (result: MetadataValuesByTypesResultDto = defaultValuesByTypesResult) =>
  jest.fn<GetValuesByTypes>().mockResolvedValue(result);

const mockGetRelatedValues = (
  result: MetadataRelatedValuesResultDto | GetRelatedValues = { groups: [] },
) =>
  typeof result === 'function'
    ? jest.fn<GetRelatedValues>().mockImplementation(result)
    : jest.fn<GetRelatedValues>().mockResolvedValue(result);

function createReader(overrides: Partial<OrgConfigMetadataReader> = {}): OrgConfigMetadataReader {
  return {
    getValuesByTypes: mockGetValuesByTypes(),
    getRelatedValues: mockGetRelatedValues(),
    ...overrides,
  };
}

describe('organizationConfig.validator', () => {
  it('throws INVALID_METADATA_VALUE when a code is missing from registry', async () => {
    const reader = createReader({
      getValuesByTypes: mockGetValuesByTypes({
        items: [
          {
            metadataType: 'Condition',
            values: [activeValue('HYPERTENSION')],
          },
        ],
        missingMetadataTypeCodes: [],
      } as MetadataValuesByTypesResultDto),
    });

    await expect(
      validateOrganizationConfigForPublish(
        { enabledConditionCodes: ['HYPERTENSION_XYZ'] },
        reader,
        'Bearer token',
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_METADATA_VALUE',
      message: 'Condition HYPERTENSION_XYZ does not exist',
    });
  });

  it('throws INVALID_METADATA_RELATION when condition does not belong to enabled category', async () => {
    const reader = createReader({
      getValuesByTypes: mockGetValuesByTypes({
        items: [
          {
            metadataType: 'Category',
            values: [activeValue('DIABETES')],
          },
          {
            metadataType: 'Condition',
            values: [activeValue('HYPERTENSION')],
          },
        ],
        missingMetadataTypeCodes: [],
      } as MetadataValuesByTypesResultDto),
      getRelatedValues: mockGetRelatedValues(async (params) => {
        if (params.fromType === 'Category') {
          return {
            groups: [
              {
                fromMetadataValueCode: 'DIABETES',
                values: [{ metadataValueCode: 'TYPE2' }],
              },
            ],
          } as MetadataRelatedValuesResultDto;
        }
        return { groups: [] };
      }),
    });

    await expect(
      validateOrganizationConfigForPublish(
        {
          enabledCategoryCodes: ['DIABETES'],
          enabledConditionCodes: ['HYPERTENSION'],
        },
        reader,
        'Bearer token',
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_METADATA_RELATION',
      message: 'Condition HYPERTENSION does not belong to any enabled Category',
    });
  });

  it('returns conditionsByCategory for capability generation', async () => {
    const reader = createReader({
      getRelatedValues: mockGetRelatedValues(async (params) => {
        if (params.fromType === 'Category') {
          return {
            groups: [
              {
                fromMetadataValueCode: 'CARDIOLOGY',
                values: [{ metadataValueCode: 'HYPERTENSION' }],
              },
            ],
          } as MetadataRelatedValuesResultDto;
        }
        return { groups: [] };
      }),
    });

    const context = await validateOrganizationConfigForPublish(
      {
        enabledCategoryCodes: ['CARDIOLOGY'],
        enabledConditionCodes: ['HYPERTENSION'],
      },
      reader,
      'Bearer token',
    );

    expect(context.conditionsByCategory.get('CARDIOLOGY')?.has('HYPERTENSION')).toBe(true);
  });

  it('computeChangedConfigSections detects field changes', () => {
    const changed = computeChangedConfigSections(
      { enabledCountryCodes: ['US'], enabledCategoryCodes: ['A'] },
      { enabledCountryCodes: ['IN'], enabledCategoryCodes: ['A'] },
    );

    expect(changed).toEqual(['enabledCountryCodes']);
  });

  it('computeChangedConfigSections detects enabledCountryCodes changes', () => {
    const changed = computeChangedConfigSections(
      { enabledCountryCodes: ['IN', 'US'] },
      { enabledCountryCodes: ['IN', 'AE'] },
    );

    expect(changed).toEqual(['enabledCountryCodes']);
  });
});
