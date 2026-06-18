import {
  buildRulesFromFieldValues,
  collectFlatLinkedItemRulePaths,
  collectRulePathsFromFieldValues,
  emitFlatLinkedItemRules,
  generateDefaultRule,
  mergeOrgRulesPartial,
  mergeRulesAdditive,
  mergeRulesAfterFieldValuesChange,
  OrgRulesValidationError,
  resolveOrgRulesFromMaster,
} from './template-rules.utils';
import { isLinkedTemplateFieldKey, TEMPLATE_TYPE_CARE_PLAN } from '../constants/template.constants';

const defaultRule = generateDefaultRule();

const carePlanLinkedTaskItem = {
  subtitle: 'Description',
  workflowStage: 'ONBOARDING',
  description: 'Description',
  ruleBadges: [{ color: '^#B54708', bg: '^#FFF6ED', label: 'Monitoring' }],
  id: 'tasks-htn-care',
  requiredForStageCompletion: true,
  title: 'HTN Care Tasks',
  version: '1.0',
  displayAsChecklistItem: false,
  generationTrigger: 'AT_REVIEW_DUE',
};

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

  it('emits CARE_PLAN LINKED_TASK_TEMPLATE container and flat inner keys in rules', () => {
    const rules = buildRulesFromFieldValues(
      {
        CATEGORY: 'CHRONIC_CARE',
        LINKED_TASK_TEMPLATE: [carePlanLinkedTaskItem],
      },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    expect(rules.CATEGORY).toEqual(defaultRule);
    expect(rules.LINKED_TASK_TEMPLATE).toMatchObject({
      enable: true,
      orgedit: true,
      min: 0,
      max: 20,
    });
    expect(rules.LINKED_TASK_TEMPLATE.workflowStage).toBeUndefined();
    expect(rules.subtitle).toEqual(defaultRule);
    expect(rules.workflowStage).toEqual(defaultRule);
    expect(rules.ruleBadges).toMatchObject({
      min: 0,
      max: 10,
    });
    expect(rules.color).toEqual(defaultRule);
    expect(rules.label).toEqual(defaultRule);
  });

  it('creates LINKED_GOAL_TEMPLATE container only when null', () => {
    const rules = buildRulesFromFieldValues(
      { LINKED_GOAL_TEMPLATE: null },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    expect(rules.LINKED_GOAL_TEMPLATE).toMatchObject({ min: 0, max: 20 });
    expect(rules.goalName).toBeUndefined();
  });

  it('emits flat inner keys for any LINKED_* key (not only task/goal/monitoring)', () => {
    const rules = buildRulesFromFieldValues(
      {
        LINKED_THRESHOLD_TEMPLATE: [{ severityLevel: 'CRITICAL', alertRequired: true }],
      },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    expect(isLinkedTemplateFieldKey('LINKED_THRESHOLD_TEMPLATE')).toBe(true);
    expect(rules.LINKED_THRESHOLD_TEMPLATE).toMatchObject({ min: 0, max: 20 });
    expect(rules.LINKED_THRESHOLD_TEMPLATE.severityLevel).toBeUndefined();
    expect(rules.severityLevel).toEqual(defaultRule);
    expect(rules.alertRequired).toEqual(defaultRule);
  });

  it('keeps GOALS inner keys flat for non-care-plan templates', () => {
    const rules = buildRulesFromFieldValues({
      GOALS: [{ goalName: 'Reduce BP', goalType: 'CLINICAL' }],
    });

    expect(rules.GOALS).toBeUndefined();
    expect(rules.goalName).toEqual(defaultRule);
  });
});

describe('emitFlatLinkedItemRules', () => {
  it('emits flat rules for linked array item keys', () => {
    const rules: Record<string, ReturnType<typeof generateDefaultRule>> = {};
    emitFlatLinkedItemRules(rules, carePlanLinkedTaskItem);
    expect(rules.workflowStage).toEqual(defaultRule);
    expect(rules.ruleBadges).toMatchObject({ min: 0, max: 10 });
    expect(rules.color).toEqual(defaultRule);
  });
});

describe('collectFlatLinkedItemRulePaths', () => {
  it('collects inner paths from LINKED_* arrays only', () => {
    const paths = collectFlatLinkedItemRulePaths({
      LINKED_TASK_TEMPLATE: [carePlanLinkedTaskItem],
      CATEGORY: 'CHRONIC_CARE',
    });
    expect(paths.has('LINKED_TASK_TEMPLATE')).toBe(false);
    expect([...paths]).toEqual(
      expect.arrayContaining(['subtitle', 'workflowStage', 'ruleBadges', 'color', 'label']),
    );
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

describe('mergeRulesAfterFieldValuesChange', () => {
  it('replaces LINKED_* container and removes stale flat inner keys', () => {
    const previousItem = { ...carePlanLinkedTaskItem, removedStaleField: 'stale' };
    const previousFieldValues = { LINKED_TASK_TEMPLATE: [previousItem] };
    const existing = buildRulesFromFieldValues(previousFieldValues, {
      templateType: TEMPLATE_TYPE_CARE_PLAN,
    });
    existing.workflowStage = { ...defaultRule, orgedit: false };

    const nextFieldValues = {
      LINKED_TASK_TEMPLATE: [
        {
          ...carePlanLinkedTaskItem,
          workflowStage: 'MAINTENANCE',
        },
      ],
    };
    const generated = buildRulesFromFieldValues(nextFieldValues, {
      templateType: TEMPLATE_TYPE_CARE_PLAN,
    });

    const merged = mergeRulesAfterFieldValuesChange(existing, generated, {
      templateType: TEMPLATE_TYPE_CARE_PLAN,
      fieldValues: nextFieldValues,
      previousFieldValues,
    });

    expect(merged.LINKED_TASK_TEMPLATE.workflowStage).toBeUndefined();
    expect(merged.workflowStage).toEqual(defaultRule);
    expect(merged.workflowStage.orgedit).toBe(true);
    expect(merged.removedStaleField).toBeUndefined();
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

  it('merges flat patches for CARE_PLAN linked inner keys', () => {
    const existing = buildRulesFromFieldValues(
      { LINKED_TASK_TEMPLATE: [carePlanLinkedTaskItem] },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );
    const merged = mergeOrgRulesPartial(existing, {
      workflowStage: { orgedit: false },
      generationTrigger: { enable: false },
    });

    expect(merged.workflowStage.orgedit).toBe(false);
    expect(merged.generationTrigger.enable).toBe(false);
    expect(merged.LINKED_TASK_TEMPLATE.min).toBe(0);
  });
});
