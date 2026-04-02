import type { RuleEngine } from '@api-hub/rule-engine';
import type { ResolvedTemplate, TemplateExecutionResult } from '../domain';

export class TemplateExecutor {
  constructor(private readonly ruleEngine: RuleEngine) {}

  execute(resolved: ResolvedTemplate, context: Record<string, unknown>): TemplateExecutionResult {
    const ruleEvaluation = this.ruleEngine.evaluate(resolved.rules, context);
    const matched = ruleEvaluation.matched;
    const actions =
      ruleEvaluation.actions.length > 0 ? ruleEvaluation.actions : matched ? resolved.actions : null;

    return {
      matched,
      actions,
      resolved,
      ruleEvaluation,
    };
  }
}
