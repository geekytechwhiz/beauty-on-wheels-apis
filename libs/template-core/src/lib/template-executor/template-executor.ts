import type { ResolvedTemplate, RuleEvaluationResult, TemplateExecutionResult } from '../types';
import type { RuleEngine } from '../template-rules/json-rule-engine';

export class TemplateExecutor {
  constructor(private readonly rules: RuleEngine) {}

  execute(resolved: ResolvedTemplate, context: unknown): TemplateExecutionResult {
    const ruleEvaluation: RuleEvaluationResult = this.rules.evaluate(resolved.rules, context);
    const matched = ruleEvaluation.matched;
    return {
      matched,
      actions: matched ? resolved.actions : null,
      resolved,
      ruleEvaluation,
    };
  }
}
