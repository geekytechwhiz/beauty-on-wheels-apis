import type { RuleSet } from '../types';
import { assertValidRuleSet } from '../validation';

function sortRules(rules: RuleSet): RuleSet {
  return [...rules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
  });
}

export class InMemoryRuleRegistry {
  private rules: RuleSet = [];

  constructor(initialRules: RuleSet = []) {
    this.replaceAll(initialRules);
  }

  replaceAll(rules: RuleSet): void {
    assertValidRuleSet(rules);
    this.rules = sortRules(rules);
  }

  addRules(rules: RuleSet): void {
    assertValidRuleSet(rules);
    this.rules = sortRules([...this.rules, ...rules]);
  }

  getAll(): RuleSet {
    return [...this.rules];
  }

  getRulesByModule(module: string): RuleSet {
    return this.rules.filter((rule) => rule.metadata.module === module);
  }

  getRulesByTemplate(templateId: string): RuleSet {
    return this.rules.filter((rule) => rule.metadata.templateId === templateId);
  }

  getRulesByVersion(module: string, version: string): RuleSet {
    return this.rules.filter(
      (rule) => rule.metadata.module === module && rule.metadata.version === version,
    );
  }
}
