import { mapTemplateConfigMetaResponse } from './template-config-meta.mapper';

const emptyApplicability = {
  module: [],
  category: [],
  condition: [],
  country: [],
  language: [],
};

describe('mapTemplateConfigMetaResponse', () => {
  it('matches upstream shape and omits status, sortOrder, and attributes from values', () => {
    const result = mapTemplateConfigMetaResponse({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [
            {
              valueCode: 'US',
              label: 'United States',
              status: 'ACTIVE',
              isGlobal: true,
              sortOrder: 2,
              attributes: { region: 'NA' },
              applicability: emptyApplicability,
            },
          ],
        },
        {
          metadataType: 'Language',
          displayName: 'Language',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [],
        },
      ],
      missingMetadataTypeCodes: ['Conditions', 'SPECIALITY'],
    });

    expect(result).toEqual({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [
            {
              valueCode: 'US',
              label: 'United States',
              isGlobal: true,
              applicability: emptyApplicability,
            },
          ],
        },
        {
          metadataType: 'Language',
          displayName: 'Language',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [],
        },
      ],
      missingMetadataTypeCodes: ['Conditions', 'SPECIALITY'],
    });
  });

  it('excludes non-ACTIVE metadata values', () => {
    const result = mapTemplateConfigMetaResponse({
      items: [
        {
          metadataType: 'Country',
          displayName: 'Country',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [
            {
              valueCode: 'US',
              label: 'United States',
              status: 'ACTIVE',
              isGlobal: true,
              sortOrder: 1,
              attributes: {},
              applicability: emptyApplicability,
            },
            {
              valueCode: 'XX',
              label: 'Inactive Country',
              status: 'INACTIVE',
              isGlobal: true,
              sortOrder: 2,
              attributes: {},
              applicability: emptyApplicability,
            },
          ],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    expect(result.items[0].values).toEqual([
      {
        valueCode: 'US',
        label: 'United States',
        isGlobal: true,
        applicability: emptyApplicability,
      },
    ]);
  });
});
