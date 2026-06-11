import {
  buildRulesFromFieldValues,
  collectRulePathsFromFieldValues,
  generateDefaultRule,
  mergeOrgRulesPartial,
  mergeRulesAdditive,
  OrgRulesValidationError,
  resolveOrgRulesFromMaster,
} from './template-rules.utils';

const defaultRule = generateDefaultRule();

describe('collectRulePathsFromFieldValues', () => {
  it('collects top-level scalar keys', () => {
    expect(
      collectRulePathsFromFieldValues({
        CATEGORY: 'CHRONIC_CARE',
        REVIEW_CADENCE: ['15_DAYS'],
      }),
    ).toEqual(expect.arrayContaining(['CATEGORY', 'REVIEW_CADENCE']));
  });

  it('expands GOALS array inner keys and skips GOALS parent', () => {
    const paths = collectRulePathsFromFieldValues({
      GOALS: [
        {
          goalName: 'Reduce BP',
          goalType: 'CLINICAL',
          measurements: [{ appliesToType: 'METRICS', linkedEntityCode: 'BP_SYS' }],
        },
      ],
    });

    expect(paths).not.toContain('GOALS');
    expect(paths).toEqual(
      expect.arrayContaining([
        'goalName',
        'goalType',
        'measurements',
        'appliesToType',
        'linkedEntityCode',
      ]),
    );
  });

  it('expands THRESHOLD_BANDS inner keys and skips parent', () => {
    const paths = collectRulePathsFromFieldValues({
      THRESHOLD_BANDS: [
        {
          alertRequired: true,
          evaluationType: 'ROLLING_AVERAGE',
          severityLevel: 'CRITICAL',
        },
      ],
    });

    expect(paths).not.toContain('THRESHOLD_BANDS');
    expect(paths).toEqual(
      expect.arrayContaining(['alertRequired', 'evaluationType', 'severityLevel']),
    );
  });

  it('adds object parent and direct child keys', () => {
    expect(
      collectRulePathsFromFieldValues({
        WORK_STRESS_LEVEL: { item1: null, item2: null },
      }),
    ).toEqual(expect.arrayContaining(['WORK_STRESS_LEVEL', 'item1', 'item2']));
  });
});

describe('buildRulesFromFieldValues', () => {
  it('generates all-true rules for each path', () => {
    const rules = buildRulesFromFieldValues({ CATEGORY: 'CHRONIC_CARE' });
    expect(rules.CATEGORY).toEqual(defaultRule);
  });
});

describe('mergeRulesAdditive', () => {
  it('adds new paths without overwriting existing rules', () => {
    const existing = {
      CATEGORY: { ...defaultRule, orgedit: false },
    };
    const merged = mergeRulesAdditive(existing, buildRulesFromFieldValues({ CONDITION: 'HYPERTENSION' }));

    expect(merged.CATEGORY.orgedit).toBe(false);
    expect(merged.CONDITION).toEqual(defaultRule);
  });
});

describe('resolveOrgRulesFromMaster', () => {
  it('prefers stored rules on master version', () => {
    const rules = resolveOrgRulesFromMaster({
      rules: { CATEGORY: { ...defaultRule, orgedit: false } },
      fieldValues: { CONDITION: 'X' },
    });
    expect(rules.CATEGORY.orgedit).toBe(false);
    expect(rules.CONDITION).toBeUndefined();
  });

  it('generates from fieldValues when rules missing', () => {
    const rules = resolveOrgRulesFromMaster({
      fieldValues: { CATEGORY: 'CHRONIC_CARE' },
    });
    expect(rules.CATEGORY).toEqual(defaultRule);
  });
});

describe('generateDefaultRule', () => {
  it('includes metadataMode, min, and max defaults', () => {
    expect(defaultRule).toEqual({
      enable: true,
      orgedit: true,
      add: true,
      defaultedit: true,
      delete: true,
      metadataMode: 'Fixed',
      min: 1,
      max: 1,
    });
  });
});

describe('mergeOrgRulesPartial', () => {
  it('merges partial booleans per field path', () => {
    const existing = buildRulesFromFieldValues({ CATEGORY: 'X', CONDITION: 'Y' });
    const merged = mergeOrgRulesPartial(existing, {
      CATEGORY: { enable: false, orgedit: false },
    });
    expect(merged.CATEGORY).toEqual({ ...defaultRule, enable: false, orgedit: false });
    expect(merged.CONDITION).toEqual(defaultRule);
  });

  it('merges metadataMode, min, and max', () => {
    const existing = buildRulesFromFieldValues({ measurements: [] });
    const merged = mergeOrgRulesPartial(existing, {
      measurements: { min: 1, max: 20 },
    });
    expect(merged.measurements.min).toBe(1);
    expect(merged.measurements.max).toBe(20);
    expect(merged.measurements.metadataMode).toBe('Fixed');
  });

  it('rejects min greater than max', () => {
    const existing = buildRulesFromFieldValues({ CATEGORY: 'X' });
    expect(() => mergeOrgRulesPartial(existing, { CATEGORY: { min: 5, max: 2 } })).toThrow(
      OrgRulesValidationError,
    );
  });

  it('rejects unknown field paths', () => {
    const existing = buildRulesFromFieldValues({ CATEGORY: 'X' });
    expect(() => mergeOrgRulesPartial(existing, { UNKNOWN: { enable: false } })).toThrow(
      OrgRulesValidationError,
    );
  });
});
