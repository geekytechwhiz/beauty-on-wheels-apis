import {
  loadMetadataCatalogFromExcel,
  resetMetadataCatalogCache,
  resolveCityStateOriginalCode,
  resolveCountriesForCurrency,
} from '../../../../helpers/excel/load-metadata-catalog';
import type { SimpleValueSeed } from '../../../../helpers/interfaces';

describe('resolveCityStateOriginalCode', () => {
  it('resolves state segment for country-prefixed and legacy city codes', () => {
    expect(resolveCityStateOriginalCode('US', 'US_TN_WILDWOOD')).toBe('TN');
    expect(resolveCityStateOriginalCode('ZA', 'ZA_MP_NELSPRUIT')).toBe('MP');
    expect(resolveCityStateOriginalCode('US', 'OH_WAUSEON')).toBe('OH');
    expect(resolveCityStateOriginalCode('ZM', '07_CHOMA')).toBe('07');
  });
});

describe('resolveCountriesForCurrency', () => {
  it('uses applicableCountries from Excel', () => {
    expect(
      resolveCountriesForCurrency({
        metadataValueCode: 'USD',
        label: 'US Dollar',
        applicableCountries: ['US'],
      }),
    ).toEqual(['US']);
    expect(
      resolveCountriesForCurrency({
        metadataValueCode: 'EUR',
        label: 'Euro',
        applicableCountries: ['DE', 'FR'],
      } satisfies SimpleValueSeed),
    ).toEqual(['DE', 'FR']);
  });
});

describe('loadMetadataCatalogFromExcel city promotion', () => {
  beforeEach(() => {
    resetMetadataCatalogCache();
  });

  it('promotes every city row to a rich value with a state relationship', () => {
    const catalog = loadMetadataCatalogFromExcel();
    const citySimple = catalog.simpleValuesByType.City?.length ?? 0;
    const cityRich = catalog.richValues.filter(
      (seed) => catalog.richValueTypeByCode[seed.metadataValueCode] === 'City',
    );

    expect(citySimple).toBe(0);
    expect(cityRich.length).toBeGreaterThan(20_000);

    expect(cityRich.find((seed) => seed.metadataValueCode === 'US_TN_WILDWOOD')?.relationships).toEqual([
      { targetMetadataValueCode: 'US_TN' },
    ]);
    expect(cityRich.find((seed) => seed.metadataValueCode === 'OH_WAUSEON')?.relationships).toEqual([
      { targetMetadataValueCode: 'US_OH' },
    ]);
  });

  it('promotes Currency values with country relationships from Excel', () => {
    const catalog = loadMetadataCatalogFromExcel();
    const currencySimple = catalog.simpleValuesByType.Currency?.length ?? 0;
    const currencyRich = catalog.richValues.filter(
      (seed) => catalog.richValueTypeByCode[seed.metadataValueCode] === 'Currency',
    );

    expect(currencySimple).toBe(0);
    expect(currencyRich).toHaveLength(2);
    expect(currencyRich.find((seed) => seed.metadataValueCode === 'USD')?.relationships).toEqual([
      { targetMetadataValueCode: 'US' },
    ]);
    expect(currencyRich.find((seed) => seed.metadataValueCode === 'INR')?.relationships).toEqual([
      { targetMetadataValueCode: 'IN' },
    ]);
  });
});
