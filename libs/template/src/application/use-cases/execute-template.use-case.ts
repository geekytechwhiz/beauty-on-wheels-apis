import type { RuleEngine } from '@api-hub/rule-engine';
import type { TemplateExecutionResult } from '../../domain';
import type { ExecuteTemplateInput } from '../dto';
import { TemplateResolver } from '../template-resolver';

export class ExecuteTemplateUseCase {
  constructor(
    private readonly resolver: TemplateResolver,
    private readonly ruleEngine: RuleEngine,
  ) {}

  async execute(input: ExecuteTemplateInput): Promise<TemplateExecutionResult> {
    const resolved = await this.resolver.resolve(input.orgId, input.templateId, input.body.version);
    const ruleEvaluation = this.ruleEngine.evaluate(resolved.rules, input.body.context);
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
