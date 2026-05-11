import {
  type ConditionTrace,
  type EvaluationContext,
  type PredicateTrace,
  type RuleCondition,
  type RuleConditionNode,
  type RuleOperator,
  type RulePredicate,
  type RuleTraceNode,
} from '../types';
import { getFactValue } from '../utils';

function evaluateOperator(operator: RuleOperator, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case 'equal':
      return actual === expected;
    case 'notEqual':
      return actual !== expected;
    case 'greaterThan':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'greaterThanOrEqual':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lessThan':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lessThanOrEqual':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected);
      }

      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }

      return false;
    case 'exists':
      return actual !== undefined && actual !== null;
    default: {
      const exhaustiveCheck: never = operator;
      return exhaustiveCheck;
    }
  }
}

export function evaluatePredicate(
  predicate: RulePredicate,
  context: EvaluationContext,
): { matched: boolean; trace: PredicateTrace } {
  const actual = getFactValue(context, predicate.fact);
  const matched = evaluateOperator(predicate.operator, actual, predicate.value);

  return {
    matched,
    trace: {
      kind: 'predicate',
      fact: predicate.fact,
      operator: predicate.operator,
      expected: predicate.value,
      actual,
      matched,
    },
  };
}

function isPredicate(node: RuleConditionNode): node is RulePredicate {
  return 'fact' in node;
}

export function evaluateCondition(
  condition: RuleCondition,
  context: EvaluationContext,
): { matched: boolean; trace: ConditionTrace } {
  if ('all' in condition) {
    const evaluations = condition.all.map((node) => evaluateConditionNode(node, context));
    const traceChildren = evaluations.map((entry) => entry.trace);

    return {
      matched: evaluations.every((entry) => entry.matched),
      trace: {
        kind: 'condition',
        operator: 'all',
        matched: evaluations.every((entry) => entry.matched),
        children: traceChildren,
      },
    };
  }

  const evaluations = condition.any.map((node) => evaluateConditionNode(node, context));
  const traceChildren = evaluations.map((entry) => entry.trace);

  return {
    matched: evaluations.some((entry) => entry.matched),
    trace: {
      kind: 'condition',
      operator: 'any',
      matched: evaluations.some((entry) => entry.matched),
      children: traceChildren,
    },
  };
}

export function evaluateConditionNode(
  node: RuleConditionNode,
  context: EvaluationContext,
): { matched: boolean; trace: RuleTraceNode } {
  if (isPredicate(node)) {
    return evaluatePredicate(node, context);
  }

  return evaluateCondition(node, context);
}
