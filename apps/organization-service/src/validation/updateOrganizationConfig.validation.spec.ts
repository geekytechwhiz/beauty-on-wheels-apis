import { describe, expect, it } from '@jest/globals';
import { updateOrganizationConfigSchema } from './organization.validation';

describe('updateOrganizationConfigSchema', () => {
  it('accepts a full config payload with changeReason', () => {
    const result = updateOrganizationConfigSchema.safeParse({
      enabledCountryCodes: ['IN'],
      enabledStateCodes: ['KA'],
      enabledCityCodes: ['BLR'],
      timezone: 'Asia/Kolkata',
      defaultLanguageCode: 'en',
      supportedLanguageCodes: ['en', 'hi'],
      enabledCategoryCodes: ['CAT_A'],
      enabledConditionCodes: ['COND_A'],
      enabledSpecialtyCodes: ['SPEC_A'],
      enabledDeviceCodes: ['DEV_A'],
      enabledVitalCodes: ['VITAL_BP'],
      enabledMetricCodes: ['METRIC_CHECKIN'],
      enabledReminderChannels: ['SMS'],
      enabledRoleTypes: ['NURSE'],
      requiredDocumentTypes: ['DOC_ID'],
      requiredAgreementTypes: ['AGR_TERMS'],
      currencyCode: 'INR',
      paymentModeCodes: ['CARD'],
      enabledModuleCodes: ['MOD_A'],
      enabledFeatureCodes: ['FEAT_A'],
      linkedOrgReferences: ['org-2'],
      requiredAgreementIds: ['agr-1'],
      changeReason: 'initial config',
    });

    expect(result.success).toBe(true);
  });

  it('accepts new optional org config fields individually', () => {
    expect(updateOrganizationConfigSchema.safeParse({ enabledStateCodes: ['KA'] }).success).toBe(true);
    expect(updateOrganizationConfigSchema.safeParse({ enabledSpecialtyCodes: ['SPEC_A'] }).success).toBe(true);
    expect(updateOrganizationConfigSchema.safeParse({ currencyCode: 'INR' }).success).toBe(true);
  });

  it('accepts enabledCountryCodes array', () => {
    const result = updateOrganizationConfigSchema.safeParse({
      enabledCountryCodes: ['IN', 'US', 'AE'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabledCountryCodes).toEqual(['IN', 'US', 'AE']);
    }
  });

  it('accepts a partial config with a single field', () => {
    const result = updateOrganizationConfigSchema.safeParse({ enabledCountryCodes: ['IN'] });
    expect(result.success).toBe(true);
  });

  it('rejects legacy single location fields', () => {
    expect(updateOrganizationConfigSchema.safeParse({ countryCode: 'IN' }).success).toBe(false);
    expect(updateOrganizationConfigSchema.safeParse({ stateCode: 'KA' }).success).toBe(false);
    expect(updateOrganizationConfigSchema.safeParse({ cityCode: 'BLR' }).success).toBe(false);
  });

  it('rejects an empty payload (no config field)', () => {
    const result = updateOrganizationConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a payload with only changeReason', () => {
    const result = updateOrganizationConfigSchema.safeParse({ changeReason: 'note' });
    expect(result.success).toBe(false);
  });

  it('trims string code values', () => {
    const result = updateOrganizationConfigSchema.parse({
      enabledCountryCodes: [' in ', ' US '],
      enabledStateCodes: [' ka '],
      supportedLanguageCodes: [' en '],
    });
    expect(result.enabledCountryCodes).toEqual(['in', 'US']);
    expect(result.enabledStateCodes).toEqual(['ka']);
    expect(result.supportedLanguageCodes).toEqual(['en']);
  });
});
