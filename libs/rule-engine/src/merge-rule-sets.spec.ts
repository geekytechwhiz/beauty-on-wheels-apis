import { mergeRuleSetsForEvaluation } from './merge-rule-sets';
import type { Rule, RuleSet } from './types';

const minimalRule = (id: string, priority: number): Rule => ({
  id,
  name: id,
  priority,
  enabled: true,
  conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] },
  actions: [{ type: 'SET', target: 'out', value: true }],
  metadata: { module: 'test', version: 'v1' },
});

describe('mergeRuleSetsForEvaluation', () => {
  it('returns template rules when global is empty', () => {
    const template: RuleSet = [minimalRule('T1', 1)];
    expect(mergeRuleSetsForEvaluation([], template)).toEqual(template);
  });

  it('prepends global rules', () => {
    const global: RuleSet = [minimalRule('G1', 1)];
    const template: RuleSet = [minimalRule('T1', 2)];
    expect(mergeRuleSetsForEvaluation(global, template)).toEqual([...global, ...template]);
  });
});
