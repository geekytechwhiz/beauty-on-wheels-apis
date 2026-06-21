import { describe, expect, it } from '@jest/globals';
import {
  extractDeviceCodes,
  extractModuleCodes,
  mapLegacyOrganizationConfigToNew,
  mapStoredOrganizationConfigToData,
  mergeLegacyOrganizationConfigPatch,
  mergeOrganizationConfigData,
} from './organizationConfig.mapper';

describe('organizationConfig.mapper', () => {
  it('maps legacy supported* fields to new config model', () => {
    const mapped = mapLegacyOrganizationConfigToNew({
      supportedCountries: ['in'],
      supportedStates: ['ka'],
      supportedLanguages: ['en', 'hi'],
      supportedCategories: ['chronic'],
      supportedConditions: ['hypertension'],
    });

    expect(mapped).toEqual({
      enabledCountryCodes: ['IN'],
      enabledStateCodes: ['KA'],
      defaultLanguageCode: 'EN',
      supportedLanguageCodes: ['EN', 'HI'],
      enabledCategoryCodes: ['CHRONIC'],
      enabledConditionCodes: ['HYPERTENSION'],
    });
  });

  it('maps legacy supportedStates to enabledStateCodes', () => {
    const mapped = mapLegacyOrganizationConfigToNew({
      supportedStates: ['ka', 'mh'],
    });

    expect(mapped.enabledStateCodes).toEqual(['KA', 'MH']);
  });

  it('maps stored CONFIG item with new fields and legacy fallback', () => {
    const mapped = mapStoredOrganizationConfigToData({
      enabledCountryCodes: ['US'],
      supportedCategories: ['LEGACY_CAT'],
    });

    expect(mapped).toEqual({
      enabledCountryCodes: ['US'],
      enabledCategoryCodes: ['LEGACY_CAT'],
    });
  });

  it('fills legacy supported* when new-model arrays are empty on read', () => {
    const mapped = mapStoredOrganizationConfigToData({
      enabledCountryCodes: ['IN'],
      enabledStateCodes: [],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_A'],
    });

    expect(mapped.enabledCountryCodes).toEqual(['IN']);
    expect(mapped.enabledStateCodes).toEqual(['KA']);
    expect(mapped.enabledCategoryCodes).toEqual(['CAT_A']);
    expect(mapped.enabledConditionCodes).toEqual(['COND_A']);
  });

  it('maps top-level modules and devices when present', () => {
    const mapped = mapLegacyOrganizationConfigToNew(
      { supportedCountries: ['US'] },
      {
        modules: { MOD_A: true, MOD_B: false },
        devices: ['BP_MONITOR', 'glucose_meter'],
      },
    );

    expect(mapped.enabledCountryCodes).toEqual(['US']);
    expect(mapped.enabledModuleCodes).toEqual(['MOD_A']);
    expect(mapped.enabledDeviceCodes).toEqual(['BP_MONITOR', 'GLUCOSE_METER']);
  });

  it('merges legacy patch with latest supported* arrays', () => {
    const merged = mergeLegacyOrganizationConfigPatch(
      { supportedLanguages: ['EN', 'ES'] },
      {
        supportedCountries: ['IN'],
        supportedLanguages: ['EN'],
        supportedStates: ['KA'],
        supportedCategories: ['CAT_A'],
        supportedConditions: ['COND_A'],
      },
    );

    expect(merged).toEqual({
      supportedCountries: ['IN'],
      supportedLanguages: ['EN', 'ES'],
      supportedStates: ['KA'],
      supportedCategories: ['CAT_A'],
      supportedConditions: ['COND_A'],
    });
  });

  it('maps legacy supportedCountries to all enabledCountryCodes', () => {
    const mapped = mapLegacyOrganizationConfigToNew({
      supportedCountries: ['in', 'us', 'ae'],
    });

    expect(mapped.enabledCountryCodes).toEqual(['IN', 'US', 'AE']);
  });

  it('reconciles enabled location arrays from legacy single-value fields on read', () => {
    const mapped = mapStoredOrganizationConfigToData({
      countryCode: 'IN',
      stateCode: 'KA',
      cityCode: 'BLR',
      enabledModuleCodes: ['MOD_A'],
    });

    expect(mapped.enabledCountryCodes).toEqual(['IN']);
    expect(mapped.enabledStateCodes).toEqual(['KA']);
    expect(mapped.enabledCityCodes).toEqual(['BLR']);
    expect(mapped.enabledModuleCodes).toEqual(['MOD_A']);
  });

  it('merges new-model patch over latest config fields', () => {
    const merged = mergeOrganizationConfigData(
      { enabledCountryCodes: ['US'], enabledSpecialtyCodes: ['SPEC_B'] },
      {
        enabledCountryCodes: ['IN'],
        enabledStateCodes: ['KA'],
        timezone: 'Asia/Kolkata',
        enabledModuleCodes: ['MOD_A'],
      },
    );

    expect(merged).toEqual({
      enabledCountryCodes: ['US'],
      enabledStateCodes: ['KA'],
      timezone: 'Asia/Kolkata',
      enabledModuleCodes: ['MOD_A'],
      enabledSpecialtyCodes: ['SPEC_B'],
    });
  });

  it('extractModuleCodes supports string arrays', () => {
    expect(extractModuleCodes(['mod_a', 'MOD_B'])).toEqual(['MOD_A', 'MOD_B']);
  });

  it('extractDeviceCodes supports object maps', () => {
    expect(extractDeviceCodes({ BP_MONITOR: true, X: false })).toEqual(['BP_MONITOR']);
  });
});
