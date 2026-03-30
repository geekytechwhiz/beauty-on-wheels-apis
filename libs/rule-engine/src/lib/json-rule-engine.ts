export interface RuleEvaluationResult {
  matched: boolean;
  trace?: unknown;
}

export interface RuleEngine {
  evaluate(rules: unknown, context: unknown): RuleEvaluationResult;
}

export type JsonRuleNode =
  | { all: JsonRuleNode[] }
  | { any: JsonRuleNode[] }
  | { not: JsonRuleNode }
  | { op: RuleOp; path: string; value?: unknown }
  | Record<string, never>;

export type RuleOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'in'
  | 'contains';

function getAtPath(ctx: unknown, path: string): unknown {
  if (!path) return ctx;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evalLeaf(node: { op: RuleOp; path: string; value?: unknown }, ctx: unknown): boolean {
  const left = getAtPath(ctx, node.path);
  const { op, value } = node;

  switch (op) {
    case 'exists':
      return left !== undefined && left !== null;
    case 'eq':
      return left === value;
    case 'neq':
      return left !== value;
    case 'gt':
      return typeof left === 'number' && typeof value === 'number' && left > value;
    case 'gte':
      return typeof left === 'number' && typeof value === 'number' && left >= value;
    case 'lt':
      return typeof left === 'number' && typeof value === 'number' && left < value;
    case 'lte':
      return typeof left === 'number' && typeof value === 'number' && left <= value;
    case 'in':
      return Array.isArray(value) && value.includes(left);
    case 'contains':
      if (typeof left === 'string' && typeof value === 'string') return left.includes(value);
      if (Array.isArray(left)) return left.includes(value);
      return false;
    default:
      return false;
  }
}

function evaluateNode(node: unknown, ctx: unknown): boolean {
  if (node === null || node === undefined) return true;
  if (typeof node !== 'object' || Array.isArray(node)) return false;

  const rule = node as JsonRuleNode;

  if ('all' in rule && Array.isArray(rule.all)) {
    return rule.all.every((child) => evaluateNode(child, ctx));
  }
  if ('any' in rule && Array.isArray(rule.any)) {
    return rule.any.some((child) => evaluateNode(child, ctx));
  }
  if ('not' in rule && rule.not !== undefined) {
    return !evaluateNode(rule.not, ctx);
  }
  if ('op' in rule && 'path' in rule && typeof (rule as { op: unknown }).op === 'string') {
    return evalLeaf(rule as { op: RuleOp; path: string; value?: unknown }, ctx);
  }

  return false;
}

export class JsonRuleEngine implements RuleEngine {
  evaluate(rules: unknown, context: unknown): RuleEvaluationResult {
    if (rules === undefined || rules === null) {
      return { matched: true, trace: { kind: 'empty_rules' } };
    }
    const matched = evaluateNode(rules, context);
    return { matched, trace: { kind: 'json_rules' } };
  }
}
