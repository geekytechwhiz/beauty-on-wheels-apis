import type { EvaluationContext } from '../types';

export function getFactValue(context: EvaluationContext, fact: string): unknown {
  if (!fact) {
    return undefined;
  }

  const segments = fact.split('.').filter(Boolean);
  let current: unknown = context;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
