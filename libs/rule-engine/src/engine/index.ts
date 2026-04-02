import { evaluateCondition } from '../evaluator';
import type {
  EvaluationContext,
  EvaluationResult,
  RuleEngine,
  RuleSet,
  RuleTraceEntry,
} from '../types';
import { assertValidRuleSet } from '../validation';

function sortRules(rules: RuleSet): RuleSet {
  return [...rules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
  });
}

export class JsonRuleEngine implements RuleEngine {
  evaluate(rules: RuleSet, context: EvaluationContext): EvaluationResult {
    assertValidRuleSet(rules);

    const trace: RuleTraceEntry[] = [];
    const appliedRuleIds: string[] = [];
    const actions: EvaluationResult['actions'] = [];

    for (const rule of sortRules(rules)) {
      if (!rule.enabled) {
        continue;
      }

      const evaluation = evaluateCondition(rule.conditions, context);
      const matchedActions = evaluation.matched ? [...rule.actions] : [];

      trace.push({
        ruleId: rule.id,
        matched: evaluation.matched,
        priority: rule.priority,
        trace: evaluation.trace,
        actions: matchedActions,
      });

      if (!evaluation.matched) {
        continue;
      }

      appliedRuleIds.push(rule.id);
      actions.push(...matchedActions);
    }

    return {
      matched: appliedRuleIds.length > 0,
      appliedRuleIds,
      actions,
      trace,
    };
  }
}
