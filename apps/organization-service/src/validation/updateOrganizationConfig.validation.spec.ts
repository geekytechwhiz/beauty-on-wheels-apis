import { describe, expect, it } from '@jest/globals';
import { updateOrganizationConfigSchema } from './organization.validation';

describe('updateOrganizationConfigSchema', () => {
  it('accepts a full config payload with changeReason', () => {
    const result = updateOrganizationConfigSchema.safeParse({
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
      defaultLanguageCode: 'en',
      supportedLanguageCodes: ['en', 'hi'],
      enabledModuleCodes: ['MOD_A'],
      enabledFeatureCodes: ['FEAT_A'],
      enabledCategoryCodes: ['CAT_A'],
      enabledConditionCodes: ['COND_A'],
      enabledMetricCodes: ['METRIC_CHECKIN'],
      enabledDeviceCodes: ['DEV_A'],
      linkedOrgReferences: ['org-2'],
      requiredAgreementIds: ['agr-1'],
      changeReason: 'initial config',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a partial config with a single field', () => {
    const result = updateOrganizationConfigSchema.safeParse({ countryCode: 'IN' });
    expect(result.success).toBe(true);
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
      countryCode: '  IN  ',
      supportedLanguageCodes: [' en '],
    });
    expect(result.countryCode).toBe('IN');
    expect(result.supportedLanguageCodes).toEqual(['en']);
  });
});
