import {
  buildRulesFromFieldValues,
  buildNestedRulesFromLinkedItem,
  collectRulePathsFromFieldValues,
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

  it('nests CARE_PLAN LINKED_TASK_TEMPLATE rules under the linking key', () => {
    const rules = buildRulesFromFieldValues(
      {
        CATEGORY: 'CHRONIC_CARE',
        LINKED_TASK_TEMPLATE: [carePlanLinkedTaskItem],
      },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    expect(rules.CATEGORY).toEqual(defaultRule);
    expect(rules.subtitle).toBeUndefined();
    expect(rules.LINKED_TASK_TEMPLATE).toMatchObject({
      enable: true,
      orgedit: true,
      min: 0,
      max: 20,
    });
    expect(rules.LINKED_TASK_TEMPLATE.workflowStage).toEqual(defaultRule);
    expect(rules.LINKED_TASK_TEMPLATE.ruleBadges).toMatchObject({
      min: 0,
      max: 10,
    });
    expect(rules.LINKED_TASK_TEMPLATE.ruleBadges?.color).toEqual(defaultRule);
  });

  it('creates LINKED_GOAL_TEMPLATE container only when null', () => {
    const rules = buildRulesFromFieldValues(
      { LINKED_GOAL_TEMPLATE: null },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    expect(rules.LINKED_GOAL_TEMPLATE).toMatchObject({ min: 0, max: 20 });
    expect(rules.LINKED_GOAL_TEMPLATE.goalName).toBeUndefined();
  });

  it('nests any LINKED_* key (not only task/goal/monitoring)', () => {
    const rules = buildRulesFromFieldValues(
      {
        LINKED_THRESHOLD_TEMPLATE: [{ severityLevel: 'CRITICAL', alertRequired: true }],
      },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    expect(isLinkedTemplateFieldKey('LINKED_THRESHOLD_TEMPLATE')).toBe(true);
    expect(rules.LINKED_THRESHOLD_TEMPLATE).toMatchObject({ min: 0, max: 20 });
    expect(rules.LINKED_THRESHOLD_TEMPLATE.severityLevel).toEqual(defaultRule);
    expect(rules.severityLevel).toBeUndefined();
  });

  it('keeps GOALS inner keys flat for non-care-plan templates', () => {
    const rules = buildRulesFromFieldValues({
      GOALS: [{ goalName: 'Reduce BP', goalType: 'CLINICAL' }],
    });

    expect(rules.GOALS).toBeUndefined();
    expect(rules.goalName).toEqual(defaultRule);
  });
});

describe('buildNestedRulesFromLinkedItem', () => {
  it('mirrors nested array item keys', () => {
    const nested = buildNestedRulesFromLinkedItem(carePlanLinkedTaskItem);
    expect(nested.workflowStage).toEqual(defaultRule);
    expect(nested.ruleBadges?.color).toEqual(defaultRule);
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
  it('replaces whole LINKED_* subtree when fieldValues shape changes', () => {
    const existing = buildRulesFromFieldValues(
      { LINKED_TASK_TEMPLATE: [carePlanLinkedTaskItem] },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );
    existing.LINKED_TASK_TEMPLATE = {
      ...existing.LINKED_TASK_TEMPLATE,
      workflowStage: { ...defaultRule, orgedit: false },
      removedStaleField: defaultRule,
    };

    const generated = buildRulesFromFieldValues(
      {
        LINKED_TASK_TEMPLATE: [
          {
            ...carePlanLinkedTaskItem,
            workflowStage: 'MAINTENANCE',
          },
        ],
      },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );

    const merged = mergeRulesAfterFieldValuesChange(existing, generated, {
      templateType: TEMPLATE_TYPE_CARE_PLAN,
    });

    expect(merged.LINKED_TASK_TEMPLATE.workflowStage).toEqual(defaultRule);
    expect(merged.LINKED_TASK_TEMPLATE.removedStaleField).toBeUndefined();
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

  it('merges nested patches under CARE_PLAN LINKED_TASK_TEMPLATE', () => {
    const existing = buildRulesFromFieldValues(
      { LINKED_TASK_TEMPLATE: [carePlanLinkedTaskItem] },
      { templateType: TEMPLATE_TYPE_CARE_PLAN },
    );
    const merged = mergeOrgRulesPartial(existing, {
      LINKED_TASK_TEMPLATE: {
        workflowStage: { orgedit: false },
        generationTrigger: { enable: false },
      },
    });

    expect(merged.LINKED_TASK_TEMPLATE.workflowStage?.orgedit).toBe(false);
    expect(merged.LINKED_TASK_TEMPLATE.generationTrigger?.enable).toBe(false);
    expect(merged.LINKED_TASK_TEMPLATE.min).toBe(0);
  });
});
