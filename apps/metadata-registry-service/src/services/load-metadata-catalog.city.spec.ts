import {
  loadMetadataCatalogFromExcel,
  resetMetadataCatalogCache,
  resolveCityStateOriginalCode,
} from '../../../../helpers/excel/load-metadata-catalog';

describe('resolveCityStateOriginalCode', () => {
  it('resolves state segment for country-prefixed and legacy city codes', () => {
    expect(resolveCityStateOriginalCode('US', 'US_TN_WILDWOOD')).toBe('TN');
    expect(resolveCityStateOriginalCode('ZA', 'ZA_MP_NELSPRUIT')).toBe('MP');
    expect(resolveCityStateOriginalCode('US', 'OH_WAUSEON')).toBe('OH');
    expect(resolveCityStateOriginalCode('ZM', '07_CHOMA')).toBe('07');
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
});
