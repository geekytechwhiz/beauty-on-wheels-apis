import { describe, expect, it } from '@jest/globals';

import { ORG_CONFIG_METADATA_TYPE_MAPPING } from './organizationConfig.metadata-types';

describe('organizationConfig.metadata-types', () => {
  it('maps metadata type codes to organizationConfig field name arrays', () => {
    expect(ORG_CONFIG_METADATA_TYPE_MAPPING.Country).toEqual(['enabledCountryCodes']);
    expect(ORG_CONFIG_METADATA_TYPE_MAPPING.Language).toEqual([
      'defaultLanguageCode',
      'supportedLanguageCodes',
    ]);
    expect(ORG_CONFIG_METADATA_TYPE_MAPPING.Category).toEqual(['enabledCategoryCodes']);
  });

  it('does not include non-metadata fields like timezone', () => {
    expect(ORG_CONFIG_METADATA_TYPE_MAPPING.timezone).toBeUndefined();
  });
});
