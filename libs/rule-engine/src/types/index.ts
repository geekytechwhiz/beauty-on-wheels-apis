export type EvaluationContext = Record<string, unknown>;

export type RuleOperator =
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'in'
  | 'contains'
  | 'exists';

export type RuleActionType = 'SET' | 'ENABLE' | 'DISABLE' | 'TRANSFORM' | 'TRIGGER_EVENT';

export interface RulePredicate {
  fact: string;
  operator: RuleOperator;
  value?: unknown;
}

export interface RuleAllCondition {
  all: RuleConditionNode[];
}

export interface RuleAnyCondition {
  any: RuleConditionNode[];
}

export type RuleCondition = RuleAllCondition | RuleAnyCondition;
export type RuleConditionNode = RuleCondition | RulePredicate;

export interface RuleAction {
  type: RuleActionType;
  target: string;
  value?: unknown;
}

export interface RuleMetadata {
  module: string;
  version: string;
  createdFrom?: string;
  sourceSheet?: string;
  templateId?: string;
  tenantId?: string;
}

export interface Rule {
  id: string;
  name: string;
  description?: string;
  sourceSheet?: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition;
  actions: RuleAction[];
  metadata: RuleMetadata;
}

export type RuleSet = Rule[];

export interface PredicateTrace {
  kind: 'predicate';
  fact: string;
  operator: RuleOperator;
  expected?: unknown;
  actual: unknown;
  matched: boolean;
}

export interface ConditionTrace {
  kind: 'condition';
  operator: 'all' | 'any';
  matched: boolean;
  children: RuleTraceNode[];
}

export type RuleTraceNode = PredicateTrace | ConditionTrace;

export interface RuleTraceEntry {
  ruleId: string;
  matched: boolean;
  priority: number;
  trace: RuleTraceNode;
  actions: RuleAction[];
}

export interface EvaluationResult {
  matched: boolean;
  appliedRuleIds: string[];
  actions: RuleAction[];
  trace: RuleTraceEntry[];
}

export interface RuleEngine {
  evaluate(rules: RuleSet, context: EvaluationContext): EvaluationResult;
}

export interface RuleValidationIssue {
  path: string;
  message: string;
}

export class RuleValidationError extends Error {
  constructor(public readonly issues: RuleValidationIssue[]) {
    super(
      `Rule validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
    );
    this.name = 'RuleValidationError';
  }
}
