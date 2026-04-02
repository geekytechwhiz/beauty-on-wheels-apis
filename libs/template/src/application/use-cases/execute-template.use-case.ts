import { mergeRuleSetsForEvaluation, type RuleEngine, type RuleSet } from '@api-hub/rule-engine';
import type { TemplateExecutionResult } from '../../domain';
import { assertSafeTemplateRuleActions } from '../../validation/template-rule-actions.validator';
import type { ExecuteTemplateInput } from '../dto';
import { TemplateResolver } from '../template-resolver';

export class ExecuteTemplateUseCase {
  constructor(
    private readonly resolver: TemplateResolver,
    private readonly ruleEngine: RuleEngine,
    /** Merged before template rules (e.g. libs/rules/global). Pass [] to disable. */
    private readonly globalRules: RuleSet = [],
  ) {}

  async execute(input: ExecuteTemplateInput): Promise<TemplateExecutionResult> {
    const resolved = await this.resolver.resolve(input.orgId, input.templateId, input.body.version);
    const mergedRules = mergeRuleSetsForEvaluation(this.globalRules, resolved.rules);
    assertSafeTemplateRuleActions(mergedRules, { scope: 'execute' });
    const ruleEvaluation = this.ruleEngine.evaluate(mergedRules, input.body.context);
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
