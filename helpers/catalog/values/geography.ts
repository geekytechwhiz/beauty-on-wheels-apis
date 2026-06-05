import type { RichValueSeed, SimpleValueSeed } from '../../interfaces';

function global(code: string, label: string, sortOrder?: number): SimpleValueSeed {
  return { metadataValueCode: code, label, isGlobal: true, sortOrder };
}

export const GEOGRAPHY_SIMPLE_VALUES: Record<string, SimpleValueSeed[]> = {
  CountryPhoneCode: [
    global('US_1', 'United States +1', 1),
    global('IN_91', 'India +91', 2),
  ],
  Currency: [global('USD', 'US Dollar', 1), global('INR', 'Indian Rupee', 2), global('GBP', 'British Pound', 3)],
};

/** Phase 3 — geography values with governed parent relations. */
export const GEOGRAPHY_RICH_VALUES: RichValueSeed[] = [
  {
    metadataValueCode: 'CA',
    label: 'California',
    isGlobal: true,
    sortOrder: 1,
    relationships: [{ targetMetadataValueCode: 'US' }],
  },
  {
    metadataValueCode: 'KA',
    label: 'Karnataka',
    isGlobal: true,
    sortOrder: 2,
    relationships: [{ targetMetadataValueCode: 'IN' }],
  },
  {
    metadataValueCode: 'SF',
    label: 'San Francisco',
    isGlobal: true,
    sortOrder: 1,
    relationships: [{ targetMetadataValueCode: 'CA' }],
  },
  {
    metadataValueCode: 'BLR',
    label: 'Bengaluru',
    isGlobal: true,
    sortOrder: 2,
    relationships: [{ targetMetadataValueCode: 'KA' }],
  },
  {
    metadataValueCode: 'USD_US',
    label: 'USD (United States)',
    isGlobal: true,
    relationships: [{ targetMetadataValueCode: 'US' }],
  },
  {
    metadataValueCode: 'INR_IN',
    label: 'INR (India)',
    isGlobal: true,
    relationships: [{ targetMetadataValueCode: 'IN' }],
  },
];

export const GEOGRAPHY_RICH_VALUE_TYPE_BY_CODE: Record<string, string> = {
  CA: 'State',
  KA: 'State',
  SF: 'City',
  BLR: 'City',
  USD_US: 'Currency',
  INR_IN: 'Currency',
};
