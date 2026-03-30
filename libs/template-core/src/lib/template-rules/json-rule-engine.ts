import type { RuleEvaluationResult } from '../types';

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
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function evalLeaf(
  node: { op: RuleOp; path: string; value?: unknown },
  ctx: unknown,
): boolean {
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

  const o = node as JsonRuleNode;

  if ('all' in o && Array.isArray(o.all)) {
    return o.all.every((n) => evaluateNode(n, ctx));
  }
  if ('any' in o && Array.isArray(o.any)) {
    return o.any.some((n) => evaluateNode(n, ctx));
  }
  if ('not' in o && o.not !== undefined) {
    return !evaluateNode(o.not, ctx);
  }
  if ('op' in o && 'path' in o && typeof (o as { op: unknown }).op === 'string') {
    return evalLeaf(o as { op: RuleOp; path: string; value?: unknown }, ctx);
  }

  return false;
}

export interface RuleEngine {
  evaluate(rules: unknown, context: unknown): RuleEvaluationResult;
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
