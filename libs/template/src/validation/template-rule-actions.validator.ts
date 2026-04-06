 
import { RuleSet } from '@api-hub/rule-engine';
import { TemplateValidationError } from '../shared/template.errors';

const ALLOWED_TEMPLATE_RULE_ACTION_TYPES = new Set(['SET', 'TRIGGER_EVENT']);

/**
 * Template rules must not perform structural mutations — only value-level SET and TRIGGER_EVENT.
 */
export function assertSafeTemplateRuleActions(rules: RuleSet, context?: Record<string, unknown>): void {
  for (const rule of rules) {
    for (const action of rule.actions) {
      if (!ALLOWED_TEMPLATE_RULE_ACTION_TYPES.has(action.type)) {
        throw new TemplateValidationError(
          `Template rule ${rule.id} uses disallowed action type ${action.type}. Only SET and TRIGGER_EVENT are permitted.`,
          'TEMPLATE.RULE_ACTION_FORBIDDEN',
          undefined,
          { ruleId: rule.id, actionType: action.type, ...context },
        );
      }
    }
  }
}
