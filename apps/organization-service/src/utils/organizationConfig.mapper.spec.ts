import { describe, expect, it } from '@jest/globals';
import {
  extractDeviceCodes,
  extractModuleCodes,
  mapLegacyOrganizationConfigToNew,
  mergeLegacyOrganizationConfigPatch,
  mergeOrganizationConfigData,
} from './organizationConfig.mapper';

describe('organizationConfig.mapper', () => {
  it('maps legacy supported* fields to new config model', () => {
    const mapped = mapLegacyOrganizationConfigToNew({
      supportedCountries: ['in'],
      supportedLanguages: ['en', 'hi'],
      supportedCategories: ['chronic'],
      supportedConditions: ['hypertension'],
    });

    expect(mapped).toEqual({
      countryCode: 'IN',
      defaultLanguageCode: 'EN',
      supportedLanguageCodes: ['EN', 'HI'],
      enabledCategoryCodes: ['CHRONIC'],
      enabledConditionCodes: ['HYPERTENSION'],
    });
  });

  it('maps top-level modules and devices when present', () => {
    const mapped = mapLegacyOrganizationConfigToNew(
      { supportedCountries: ['US'] },
      {
        modules: { MOD_A: true, MOD_B: false },
        devices: ['BP_MONITOR', 'glucose_meter'],
      },
    );

    expect(mapped.countryCode).toBe('US');
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

  it('merges new-model patch over latest config fields', () => {
    const merged = mergeOrganizationConfigData(
      { countryCode: 'US', enabledSpecialtyCodes: ['SPEC_B'] },
      {
        countryCode: 'IN',
        stateCode: 'KA',
        timezone: 'Asia/Kolkata',
        enabledModuleCodes: ['MOD_A'],
      },
    );

    expect(merged).toEqual({
      countryCode: 'US',
      stateCode: 'KA',
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
