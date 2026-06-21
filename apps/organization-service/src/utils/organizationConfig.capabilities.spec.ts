import { describe, expect, it } from '@jest/globals';

import { buildOrgCapabilities, deriveCategoryConditionPairs } from './organizationConfig.capabilities';

describe('organizationConfig.capabilities', () => {
  it('builds deterministic CAP-{CATEGORY}__{CONDITION} IDs', () => {
    const capabilities = buildOrgCapabilities([
      { categoryCode: 'chronic', conditionCode: 'hypertension' },
      { categoryCode: 'CHRONIC', conditionCode: 'DIABETES' },
    ]);

    expect(capabilities).toEqual(['CAP-CHRONIC__DIABETES', 'CAP-CHRONIC__HYPERTENSION']);
  });

  it('derives pairs from enabled categories and conditions', () => {
    const conditionsByCategory = new Map<string, Set<string>>([
      ['CARDIOLOGY', new Set(['HYPERTENSION', 'AFIB'])],
      ['DIABETES', new Set(['TYPE2'])],
    ]);

    const pairs = deriveCategoryConditionPairs(
      {
        enabledCategoryCodes: ['CARDIOLOGY', 'DIABETES'],
        enabledConditionCodes: ['HYPERTENSION', 'TYPE2'],
      },
      conditionsByCategory,
    );

    expect(pairs).toEqual([
      { categoryCode: 'CARDIOLOGY', conditionCode: 'HYPERTENSION' },
      { categoryCode: 'DIABETES', conditionCode: 'TYPE2' },
    ]);
  });
});
