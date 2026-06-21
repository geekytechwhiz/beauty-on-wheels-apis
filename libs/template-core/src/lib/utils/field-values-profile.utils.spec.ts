import {
  extractCatalogCodes,
  extractLabelValue,
  isLabelValueObject,
  isLabelValueOnlyArray,
  normalizeLinkValueForRules,
  resolveTemplateDisplayName,
} from './field-values-profile.utils';

const consoleCarePlanFieldValues = {
  Category: { labelKey: 'Chronic Disease', value: 'CHRONIC_DISEASE' },
  Condition: { labelKey: 'Hypertension', value: 'HYPERTENSION' },
  Country: { labelKey: 'India', value: 'IN' },
  LinkedTaskTemplate: [],
  LinkedGoalTemplate: {
    id: 'TEST-GOAL-45',
    title: 'TEST goal 45',
    conditionBadge: { label: 'Diabetes', color: '^#B54708', bg: '^#FFF6ED' },
  },
  ReviewCadence: [
    { labelKey: '15 Days', value: '15_DAYS' },
    { labelKey: '30 Days', value: '30_DAYS' },
  ],
};

describe('extractLabelValue', () => {
  it('reads value from console select object', () => {
    expect(extractLabelValue({ labelKey: 'Hypertension', value: 'HYPERTENSION' })).toBe(
      'HYPERTENSION',
    );
  });

  it('returns plain strings', () => {
    expect(extractLabelValue('CHRONIC_CARE')).toBe('CHRONIC_CARE');
  });
});

describe('extractCatalogCodes', () => {
  it('extracts console Category and Condition values', () => {
    expect(extractCatalogCodes(consoleCarePlanFieldValues)).toEqual({
      categoryCode: 'CHRONIC_DISEASE',
      conditionCode: 'HYPERTENSION',
      country: 'IN',
      language: undefined,
      specialty: undefined,
      shareScope: undefined,
    });
  });

  it('falls back to legacy CATEGORY and CONDITION strings', () => {
    expect(
      extractCatalogCodes({
        CATEGORY: 'CHRONIC_CARE',
        CONDITION: 'DIABETES',
      }),
    ).toMatchObject({
      categoryCode: 'CHRONIC_CARE',
      conditionCode: 'DIABETES',
    });
  });
});

describe('resolveTemplateDisplayName', () => {
  it('accepts TemplateName at body root', () => {
    expect(
      resolveTemplateDisplayName({ TemplateName: 'test template' }, {}),
    ).toBe('test template');
  });
});

describe('normalizeLinkValueForRules', () => {
  it('returns undefined for empty linked arrays', () => {
    expect(normalizeLinkValueForRules([])).toBeUndefined();
  });

  it('returns card object for single linked template', () => {
    expect(normalizeLinkValueForRules(consoleCarePlanFieldValues.LinkedGoalTemplate)).toEqual({
      id: 'TEST-GOAL-45',
      title: 'TEST goal 45',
      conditionBadge: { label: 'Diabetes', color: '^#B54708', bg: '^#FFF6ED' },
    });
  });
});

describe('label value helpers', () => {
  it('detects label value objects and arrays', () => {
    expect(isLabelValueObject({ labelKey: 'x', value: 'Y' })).toBe(true);
    expect(isLabelValueOnlyArray(consoleCarePlanFieldValues.ReviewCadence)).toBe(true);
  });
});
