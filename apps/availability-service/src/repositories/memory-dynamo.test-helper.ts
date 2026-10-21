type Item = Record<string, unknown> & { PK: string; SK: string };

interface Names {
  [key: string]: string;
}

interface Values {
  [key: string]: unknown;
}

function itemKey(pk: string, sk: string): string {
  return `${pk}\u0000${sk}`;
}

function conditionalFailure(): Error {
  const error = new Error('ConditionalCheckFailed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

function canceled(reasons: Array<{ Code: string }>): Error {
  const error = new Error('Transaction canceled');
  error.name = 'TransactionCanceledException';
  (error as Error & { CancellationReasons: Array<{ Code: string }> }).CancellationReasons =
    reasons;
  return error;
}

function resolveAtom(
  atom: string,
  item: Item | undefined,
  names: Names,
  values: Values,
): unknown {
  if (atom.startsWith(':')) {
    return values[atom];
  }
  if (!item) {
    return undefined;
  }
  if (atom.startsWith('#')) {
    return item[names[atom]];
  }
  return item[atom];
}

function evalExpr(
  expr: string,
  item: Item | undefined,
  names: Names,
  values: Values,
): unknown {
  return resolveAtom(expr.trim(), item, names, values);
}

function evalClause(
  clause: string,
  item: Item | undefined,
  names: Names,
  values: Values,
): boolean {
  const text = clause.trim();
  const exists = text.match(/^attribute_exists\(([A-Za-z0-9_]+)\)$/);
  if (exists) {
    return Boolean(item) && item?.[exists[1]] !== undefined;
  }
  const missing = text.match(/^attribute_not_exists\(([A-Za-z0-9_]+)\)$/);
  if (missing) {
    return !item || item[missing[1]] === undefined;
  }
  const match = text.match(/^(.+?)\s*(<>|>=|<=|=|>|<)\s*(.+)$/);
  if (!match) {
    throw new Error(`Unsupported condition clause: ${text}`);
  }
  const left = evalExpr(match[1], item, names, values);
  const right = evalExpr(match[3], item, names, values);
  if (left === undefined || right === undefined) {
    return false;
  }
  switch (match[2]) {
    case '=':
      return left === right;
    case '<>':
      return left !== right;
    case '>':
      return compare(left, right) > 0;
    case '>=':
      return compare(left, right) >= 0;
    case '<':
      return compare(left, right) < 0;
    case '<=':
      return compare(left, right) <= 0;
    default:
      return false;
  }
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

export function conditionPasses(
  expression: string | undefined,
  item: Item | undefined,
  names: Names = {},
  values: Values = {},
): boolean {
  if (!expression) {
    return true;
  }
  if (expression.includes('+')) {
    const error = new Error(
      `Invalid ConditionExpression: Syntax error; token: "+", near: "${expression}"`,
    );
    error.name = 'ValidationException';
    throw error;
  }
  assertAttributeNamesDefined(expression, names);
  return splitTopLevel(expression, ' OR ').some((orClause) =>
    splitTopLevel(stripWrappingParens(orClause), ' AND ').every((clause) =>
      evalClause(stripWrappingParens(clause), item, names, values),
    ),
  );
}

function stripWrappingParens(value: string): string {
  let text = value.trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }
      if (depth === 0 && index < text.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll || depth !== 0) {
      break;
    }
    text = text.slice(1, -1).trim();
  }
  return text;
}

function assertAttributeNamesDefined(expression: string, names: Names): void {
  const tokens = expression.match(/#[A-Za-z0-9_]+/g) ?? [];
  for (const token of tokens) {
    if (names[token] === undefined) {
      const error = new Error(
        `Invalid ConditionExpression: An expression attribute name used in the document path is not defined; attribute name: ${token}`,
      );
      error.name = 'ValidationException';
      throw error;
    }
  }
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    }
    if (depth === 0 && input.startsWith(separator, index)) {
      parts.push(current);
      current = '';
      index += separator.length - 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

function evalOperand(
  token: string,
  item: Item,
  names: Names,
  values: Values,
): unknown {
  const trimmed = token.trim();
  const fallback = trimmed.match(/^if_not_exists\(([A-Za-z0-9_#]+),\s*(:[A-Za-z0-9]+)\)$/);
  if (fallback) {
    const current = resolveAtom(fallback[1], item, names, values);
    if (current !== undefined) {
      return current;
    }
    return resolveAtom(fallback[2], item, names, values);
  }
  return resolveAtom(trimmed, item, names, values);
}

function evalUpdateValue(
  rawRight: string,
  item: Item,
  names: Names,
  values: Values,
): unknown {
  const arithmetic = rawRight.match(/^(.*)\s([+-])\s(\S+)$/);
  if (!arithmetic) {
    return evalOperand(rawRight, item, names, values);
  }
  const base = Number(evalOperand(arithmetic[1], item, names, values) ?? 0);
  const delta = Number(evalOperand(arithmetic[3], item, names, values) ?? 0);
  return arithmetic[2] === '+' ? base + delta : base - delta;
}

function applyUpdate(item: Item, action: Record<string, unknown>): Item {
  const next = { ...item };
  const expression = String(action.UpdateExpression ?? '');
  const names = (action.ExpressionAttributeNames ?? {}) as Names;
  const values = (action.ExpressionAttributeValues ?? {}) as Values;
  const [setPart, removePart] = expression.split(' REMOVE ');
  if (removePart) {
    for (const token of removePart.split(',')) {
      const attribute = token.trim();
      delete next[attribute];
    }
  }
  const assignments = setPart.replace(/^SET\s+/, '');
  for (const assignment of splitTopLevel(assignments, ',')) {
    const separator = assignment.indexOf('=');
    const rawLeft = assignment.slice(0, separator).trim();
    const rawRight = assignment.slice(separator + 1).trim();
    const left = rawLeft.startsWith('#') ? names[rawLeft] : rawLeft;
    next[left] = evalUpdateValue(rawRight, item, names, values);
  }
  return next;
}

export class MemoryDynamo {
  private items = new Map<string, Item>();
  private queue: Promise<void> = Promise.resolve();

  reset(): void {
    this.items.clear();
  }

  dump(): Item[] {
    return [...this.items.values()].map((item) => ({ ...item }));
  }

  exclusive<T>(work: () => T): Promise<T> {
    const run = this.queue.then(() => work());
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  get(key: { PK: string; SK: string }): Item | undefined {
    const found = this.items.get(itemKey(key.PK, key.SK));
    return found ? { ...found } : undefined;
  }

  put(action: Record<string, unknown>): void {
    const item = action.Item as Item;
    const existing = this.items.get(itemKey(item.PK, item.SK));
    if (
      !conditionPasses(
        action.ConditionExpression as string | undefined,
        existing,
        (action.ExpressionAttributeNames ?? {}) as Names,
        (action.ExpressionAttributeValues ?? {}) as Values,
      )
    ) {
      throw conditionalFailure();
    }
    this.items.set(itemKey(item.PK, item.SK), { ...item });
  }

  update(action: Record<string, unknown>): void {
    const key = action.Key as { PK: string; SK: string };
    const existing = this.items.get(itemKey(key.PK, key.SK));
    if (
      !conditionPasses(
        action.ConditionExpression as string | undefined,
        existing,
        (action.ExpressionAttributeNames ?? {}) as Names,
        (action.ExpressionAttributeValues ?? {}) as Values,
      )
    ) {
      throw conditionalFailure();
    }
    if (!existing) {
      throw conditionalFailure();
    }
    this.items.set(itemKey(key.PK, key.SK), applyUpdate(existing, action));
  }

  delete(action: Record<string, unknown>): void {
    const key = action.Key as { PK: string; SK: string };
    const existing = this.items.get(itemKey(key.PK, key.SK));
    if (
      !conditionPasses(
        action.ConditionExpression as string | undefined,
        existing,
        {},
        (action.ExpressionAttributeValues ?? {}) as Values,
      )
    ) {
      throw conditionalFailure();
    }
    this.items.delete(itemKey(key.PK, key.SK));
  }

  transact(input: { TransactItems?: Array<Record<string, Record<string, unknown>>> }): void {
    const snapshot = new Map(this.items);
    const reasons: Array<{ Code: string }> = [];
    try {
      for (const entry of input.TransactItems ?? []) {
        const [operation, action] = Object.entries(entry)[0];
        try {
          if (operation === 'Put') {
            this.put(action);
          } else if (operation === 'Update') {
            this.update(action);
          } else if (operation === 'Delete') {
            this.delete(action);
          } else {
            throw new Error(`Unsupported ${operation}`);
          }
          reasons.push({ Code: 'None' });
        } catch (error) {
          reasons.push({
            Code:
              error instanceof Error && error.name === 'ConditionalCheckFailedException'
                ? 'ConditionalCheckFailed'
                : 'ValidationError',
          });
          throw error;
        }
      }
    } catch (error) {
      this.items = snapshot;
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        while (reasons.length < (input.TransactItems?.length ?? 0)) {
          reasons.push({ Code: 'None' });
        }
        throw canceled(reasons);
      }
      throw error;
    }
  }

  query(input: Record<string, unknown>): { Items: Item[] } {
    const values = (input.ExpressionAttributeValues ?? {}) as Values;
    const names = (input.ExpressionAttributeNames ?? {}) as Names;
    const expression = String(input.KeyConditionExpression ?? '');
    const indexName = input.IndexName as string | undefined;
    const matches = [...this.items.values()].filter((item) => {
      if (indexName === 'GSI1') {
        return matchesKey(expression, item, 'GSI1PK', 'GSI1SK', values);
      }
      return matchesKey(expression, item, 'PK', 'SK', values);
    }).filter((item) =>
      conditionPasses(input.FilterExpression as string | undefined, item, names, values),
    );
    const sorted = [...matches].sort((left, right) => {
      const skName = indexName === 'GSI1' ? 'GSI1SK' : 'SK';
      return String(left[skName]).localeCompare(String(right[skName]));
    });
    if (input.ScanIndexForward === false) {
      sorted.reverse();
    }
    return { Items: sorted.map((item) => ({ ...item })) };
  }
}

function matchesKey(
  expression: string,
  item: Item,
  pkName: string,
  skName: string,
  values: Values,
): boolean {
  if (!expression.includes(`${pkName} = :pk`) && !expression.includes('PK = :pk') && !expression.includes('GSI1PK = :pk')) {
    return false;
  }
  const pkToken = expression.includes('GSI1PK') ? 'GSI1PK' : 'PK';
  if (item[pkToken] !== values[':pk'] && item[pkName] !== values[':pk']) {
    return false;
  }
  if (expression.includes('begins_with')) {
    return String(item[skName] ?? '').startsWith(String(values[':prefix']));
  }
  if (expression.includes('BETWEEN')) {
    const sk = String(item[skName] ?? '');
    return sk >= String(values[':from']) && sk <= String(values[':to']);
  }
  return item[pkName] === values[':pk'];
}
