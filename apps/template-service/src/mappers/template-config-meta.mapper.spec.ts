import { mapTemplateConfigMetaResponse } from './template-config-meta.mapper';

describe('mapTemplateConfigMetaResponse', () => {
  it('maps Enum metadata with type and option values preserved as-is', () => {
    const result = mapTemplateConfigMetaResponse({
      items: [
        {
          metadataType: 'MissedMonitoringAction',
          displayName: 'Missed Monitoring Action',
          multiSelectAllowed: false,
          required: false,
          valueDataType: 'Enum',
          isGlobal: false,
          sortOrder: 1,
          attributes: {},
          applicability: {
            module: [],
            category: [],
            condition: [],
            country: [],
            language: [],
          },
          values: [
            {
              valueCode: 'CREATE_ALERT',
              label: 'Create Alert',
              description: 'Create alert when missed monitoring threshold is met',
              status: 'ACTIVE',
              isGlobal: false,
              sortOrder: 1,
              attributes: {},
              applicability: {
                module: [],
                category: [],
                condition: [],
                country: [],
                language: [],
              },
            },
            {
              valueCode: 'NONE',
              label: 'None',
              description: 'Do not track missed monitoring for action/alert purposes',
              status: 'ACTIVE',
              isGlobal: false,
              sortOrder: 2,
              attributes: {},
              applicability: {
                module: [],
                category: [],
                condition: [],
                country: [],
                language: [],
              },
            },
            {
              valueCode: 'TRACK_ONLY',
              label: 'Track only',
              status: 'INACTIVE',
              isGlobal: false,
              sortOrder: 3,
              attributes: {},
              applicability: {
                module: [],
                category: [],
                condition: [],
                country: [],
                language: [],
              },
            },
          ],
        },
      ],
      missingMetadataTypeCodes: ['SPECIALITY'],
    });

    expect(result).toEqual({
      items: [
        {
          code: 'MissedMonitoringAction',
          displayName: 'Missed Monitoring Action',
          isGlobal: false,
          type: 'Enum',
          labelKey: 'missedmonitoringaction.label',
          placeholderKey: 'missedmonitoringaction.placeholder',
          options: [
            {
              labelKey: 'Create Alert',
              value: 'CREATE_ALERT',
              description: 'Create alert when missed monitoring threshold is met',
            },
            {
              labelKey: 'None',
              value: 'NONE',
              description: 'Do not track missed monitoring for action/alert purposes',
            },
          ],
          validation: {},
        },
      ],
      missingMetadataTypeCodes: ['SPECIALITY'],
    });
  });

  it('maps non-enum metadata with valueDataType as type and empty options', () => {
    const result = mapTemplateConfigMetaResponse({
      items: [
        {
          metadataType: 'FreeTextConfig',
          displayName: 'Free Text Config',
          multiSelectAllowed: false,
          required: true,
          valueDataType: 'Text',
          isGlobal: true,
          sortOrder: 1,
          attributes: {},
          applicability: {
            module: [],
            category: [],
            condition: [],
            country: [],
            language: [],
          },
          values: [
            {
              valueCode: 'IGNORED_FOR_TEXT',
              label: 'Ignored for Text',
              status: 'ACTIVE',
              isGlobal: true,
              sortOrder: 1,
              attributes: {},
              applicability: {
                module: [],
                category: [],
                condition: [],
                country: [],
                language: [],
              },
            },
          ],
        },
      ],
      missingMetadataTypeCodes: [],
    });

    expect(result.items[0]).toEqual({
      code: 'FreeTextConfig',
      displayName: 'Free Text Config',
      isGlobal: true,
      type: 'Text',
      labelKey: 'freetextconfig.label',
      placeholderKey: 'freetextconfig.placeholder',
      options: [],
      validation: {
        required: {
          value: true,
          messageKey: 'FreeTextConfig.validation.required',
        },
      },
    });
  });
});
