import { describe, expect, it, jest } from '@jest/globals';

import type { OrgConfigMetadataReader } from './organizationConfig.validator';
import {
  collectMetadataTypesForConfigRead,
  fetchOrganizationConfigMetadataDefaults,
  mapMetadataDefaultsFromRegistry,
  ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES,
} from './organizationConfig.metadata-defaults';

type GetValuesByTypes = OrgConfigMetadataReader['getValuesByTypes'];
type GetRelatedValues = OrgConfigMetadataReader['getRelatedValues'];

const registryValue = (
  valueCode: string,
  label: string,
  sortOrder: number,
  status = 'active',
) => ({
  valueCode,
  label,
  status,
  isGlobal: true,
  sortOrder,
  attributes: {},
  applicability: { module: [], category: [], condition: [], country: [], language: [] },
});

describe('organizationConfig.metadata-defaults', () => {
  it('collectMetadataTypesForConfigRead always includes default dropdown types', () => {
    expect(collectMetadataTypesForConfigRead({})).toEqual([
      ...ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES,
    ]);
    expect(collectMetadataTypesForConfigRead({ enabledCountryCodes: ['IN'] })).toEqual(
      expect.arrayContaining(['Country', ...ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES]),
    );
    expect(collectMetadataTypesForConfigRead({ enabledCountryCodes: ['IN', 'US'] })).toEqual(
      expect.arrayContaining(['Country', ...ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES]),
    );
  });

  it('mapMetadataDefaultsFromRegistry maps ACTIVE values sorted by sortOrder', () => {
    const defaults = mapMetadataDefaultsFromRegistry({
      items: [
        {
          metadataType: 'Specialty',
          displayName: 'Specialty',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [
            registryValue('CARDIOLOGY', 'Cardiology', 2),
            registryValue('NEUROLOGY', 'Neurology', 1),
            registryValue('INACTIVE_SPEC', 'Inactive', 0, 'inactive'),
          ],
        },
        {
          metadataType: 'Department',
          displayName: 'Department',
          multiSelectAllowed: true,
          valueDataType: 'Enum',
          values: [registryValue('CARDIO_DEPT', 'Cardiology Dept', 1)],
        },
      ],
      missingMetadataTypeCodes: ['ProgramType'],
    });

    expect(defaults.specialty).toEqual([
      { valueCode: 'NEUROLOGY', label: 'Neurology' },
      { valueCode: 'CARDIOLOGY', label: 'Cardiology' },
    ]);
    expect(defaults.department).toEqual([{ valueCode: 'CARDIO_DEPT', label: 'Cardiology Dept' }]);
    expect(defaults.programType).toEqual([]);
  });

  it('fetchOrganizationConfigMetadataDefaults returns undefined when registry fails', async () => {
    const reader: OrgConfigMetadataReader = {
      getValuesByTypes: jest.fn<GetValuesByTypes>().mockRejectedValue(new Error('registry down')),
      getRelatedValues: jest.fn<GetRelatedValues>(),
    };

    await expect(
      fetchOrganizationConfigMetadataDefaults(reader, 'Bearer token'),
    ).resolves.toBeUndefined();
  });
});
