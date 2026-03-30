import type { RuleEngine } from '@api-hub/rule-engine';
import type { ResolvedTemplate, TemplateExecutionResult } from '../domain';

export class TemplateExecutor {
  constructor(private readonly ruleEngine: RuleEngine) {}

  execute(resolved: ResolvedTemplate, context: unknown): TemplateExecutionResult {
    const ruleEvaluation = this.ruleEngine.evaluate(resolved.rules, context);
    const matched = ruleEvaluation.matched;

    return {
      matched,
      actions: matched ? resolved.actions : null,
      resolved,
      ruleEvaluation: {
        matched: ruleEvaluation.matched,
        trace: ruleEvaluation.trace,
      },
    };
  }
}
