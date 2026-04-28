import { JsonRuleEngine } from './index';
import { RuleValidationError, type RuleSet } from '../types';

describe('JsonRuleEngine', () => {
  it('applies enabled rules in priority order and aggregates actions', () => {
    const rules: RuleSet = [
      {
        id: 'RULE_2',
        name: 'Lower priority rule',
        priority: 2,
        enabled: true,
        conditions: {
          all: [{ fact: 'region', operator: 'equal', value: 'US' }],
        },
        actions: [{ type: 'ENABLE', target: 'feature.secondary' }],
        metadata: {
          module: 'template',
          version: 'v1',
        },
      },
      {
        id: 'RULE_1',
        name: 'Highest priority rule',
        priority: 1,
        enabled: true,
        conditions: {
          all: [{ fact: 'segment', operator: 'equal', value: 'enterprise' }],
        },
        actions: [{ type: 'ENABLE', target: 'feature.primary' }],
        metadata: {
          module: 'template',
          version: 'v1',
        },
      },
      {
        id: 'RULE_DISABLED',
        name: 'Disabled rule',
        priority: 0,
        enabled: false,
        conditions: {
          all: [{ fact: 'segment', operator: 'equal', value: 'enterprise' }],
        },
        actions: [{ type: 'ENABLE', target: 'feature.disabled' }],
        metadata: {
          module: 'template',
          version: 'v1',
        },
      },
    ];

    const result = new JsonRuleEngine().evaluate(rules, {
      segment: 'enterprise',
      region: 'US',
    });

    expect(result.matched).toBe(true);
    expect(result.appliedRuleIds).toEqual(['RULE_1', 'RULE_2']);
    expect(result.actions).toEqual([
      { type: 'ENABLE', target: 'feature.primary' },
      { type: 'ENABLE', target: 'feature.secondary' },
    ]);
    expect(result.trace).toHaveLength(2);
  });

  it('throws when a rule set is invalid', () => {
    const engine = new JsonRuleEngine();

    expect(() =>
      engine.evaluate(
        [
          {
            id: '',
            name: 'Broken rule',
            priority: 1,
            enabled: true,
            conditions: {
              all: [],
            },
            actions: [],
            metadata: {
              module: 'template',
              version: 'v1',
            },
          },
        ] as RuleSet,
        {},
      ),
    ).toThrow(RuleValidationError);
  });
});
