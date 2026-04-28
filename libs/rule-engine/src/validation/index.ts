import {
  RuleValidationError,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleConditionNode,
  type RulePredicate,
  type RuleSet,
  type RuleValidationIssue,
} from '../types';
import { isRecord } from '../utils';

const SUPPORTED_OPERATORS = new Set([
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'in',
  'contains',
  'exists',
]);

const SUPPORTED_ACTION_TYPES = new Set(['SET', 'ENABLE', 'DISABLE', 'TRANSFORM', 'TRIGGER_EVENT']);

function pushIssue(issues: RuleValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isConditionNode(value: unknown): value is RuleConditionNode {
  return isRecord(value) && ('all' in value || 'any' in value || 'fact' in value);
}

function validateAction(action: unknown, path: string, issues: RuleValidationIssue[]): action is RuleAction {
  if (!isRecord(action)) {
    pushIssue(issues, path, 'Action must be an object.');
    return false;
  }

  if (typeof action.type !== 'string' || !SUPPORTED_ACTION_TYPES.has(action.type)) {
    pushIssue(issues, `${path}.type`, 'Action type is invalid.');
  }

  if (typeof action.target !== 'string' || action.target.trim() === '') {
    pushIssue(issues, `${path}.target`, 'Action target is required.');
  }

  return true;
}

function validatePredicate(
  predicate: unknown,
  path: string,
  issues: RuleValidationIssue[],
): predicate is RulePredicate {
  if (!isRecord(predicate)) {
    pushIssue(issues, path, 'Predicate must be an object.');
    return false;
  }

  if (typeof predicate.fact !== 'string' || predicate.fact.trim() === '') {
    pushIssue(issues, `${path}.fact`, 'Predicate fact is required.');
  }

  if (typeof predicate.operator !== 'string' || !SUPPORTED_OPERATORS.has(predicate.operator)) {
    pushIssue(issues, `${path}.operator`, 'Predicate operator is invalid.');
  }

  if (predicate.operator !== 'exists' && !('value' in predicate)) {
    pushIssue(issues, `${path}.value`, 'Predicate value is required for this operator.');
  }

  return true;
}

function validateCondition(condition: unknown, path: string, issues: RuleValidationIssue[]): condition is RuleCondition {
  if (!isRecord(condition)) {
    pushIssue(issues, path, 'Condition must be an object.');
    return false;
  }

  if ('all' in condition) {
    if (!Array.isArray(condition.all) || condition.all.length === 0) {
      pushIssue(issues, `${path}.all`, 'Condition all must be a non-empty array.');
      return false;
    }

    condition.all.forEach((node, index) => validateConditionNode(node, `${path}.all[${index}]`, issues));
    return true;
  }

  if ('any' in condition) {
    if (!Array.isArray(condition.any) || condition.any.length === 0) {
      pushIssue(issues, `${path}.any`, 'Condition any must be a non-empty array.');
      return false;
    }

    condition.any.forEach((node, index) => validateConditionNode(node, `${path}.any[${index}]`, issues));
    return true;
  }

  pushIssue(issues, path, 'Condition must contain either all or any.');
  return false;
}

function validateConditionNode(node: unknown, path: string, issues: RuleValidationIssue[]): void {
  if (!isConditionNode(node)) {
    pushIssue(issues, path, 'Condition node must be a predicate or nested condition.');
    return;
  }

  if ('fact' in node) {
    validatePredicate(node, path, issues);
    return;
  }

  validateCondition(node, path, issues);
}

function validateRule(rule: unknown, path: string, issues: RuleValidationIssue[]): rule is Rule {
  if (!isRecord(rule)) {
    pushIssue(issues, path, 'Rule must be an object.');
    return false;
  }

  if (typeof rule.id !== 'string' || rule.id.trim() === '') {
    pushIssue(issues, `${path}.id`, 'Rule id is required.');
  }

  if (typeof rule.name !== 'string' || rule.name.trim() === '') {
    pushIssue(issues, `${path}.name`, 'Rule name is required.');
  }

  if (typeof rule.priority !== 'number' || Number.isNaN(rule.priority)) {
    pushIssue(issues, `${path}.priority`, 'Rule priority must be a number.');
  }

  if (typeof rule.enabled !== 'boolean') {
    pushIssue(issues, `${path}.enabled`, 'Rule enabled must be a boolean.');
  }

  validateCondition(rule.conditions, `${path}.conditions`, issues);

  if (!Array.isArray(rule.actions)) {
    pushIssue(issues, `${path}.actions`, 'Rule actions must be an array.');
  } else {
    rule.actions.forEach((action, index) => validateAction(action, `${path}.actions[${index}]`, issues));
  }

  if (!isRecord(rule.metadata)) {
    pushIssue(issues, `${path}.metadata`, 'Rule metadata must be an object.');
  } else {
    if (typeof rule.metadata.module !== 'string' || rule.metadata.module.trim() === '') {
      pushIssue(issues, `${path}.metadata.module`, 'Rule metadata.module is required.');
    }

    if (typeof rule.metadata.version !== 'string' || rule.metadata.version.trim() === '') {
      pushIssue(issues, `${path}.metadata.version`, 'Rule metadata.version is required.');
    }
  }

  return true;
}

export function validateRuleSet(input: unknown): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];

  if (!Array.isArray(input)) {
    pushIssue(issues, 'rules', 'Rule set must be an array.');
    return issues;
  }

  input.forEach((rule, index) => validateRule(rule, `rules[${index}]`, issues));
  return issues;
}

export function assertValidRuleSet(input: unknown): asserts input is RuleSet {
  const issues = validateRuleSet(input);
  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }
}
