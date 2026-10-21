import { createHash } from 'node:crypto';

import { ValidationError } from '@api-hub/utils';

import { isAfterSortTuple, sortTuple } from './sort-registry';
import {
  OfferingCandidate,
  ParsedOfferingsQuery,
} from './types';

interface OfferingsCursor {
  version: 1;
  fingerprint: string;
  tuple: Array<string | number>;
}

export function queryFingerprint(query: ParsedOfferingsQuery): string {
  const canonical = {
    clauses: [...query.clauses]
      .map((clause) => ({
        field: clause.field,
        operator: clause.operator,
        value: clause.value,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    search: query.search ?? '',
    location: query.location ?? null,
    availableOn: query.availableOn ?? '',
    startTime: query.startTime ?? '',
    sorts: query.sorts,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function encodeOfferingsCursor(cursor: OfferingsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeOfferingsCursor(token?: string): OfferingsCursor | undefined {
  if (!token) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
    if (!isCursor(parsed)) {
      throw new ValidationError('Invalid offerings cursor');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Invalid offerings cursor');
  }
}

/**
 * Keyset over the already sorted complete result.
 * Rows at or before the cursor tuple stay on earlier pages.
 */
export function pageOfferings(
  items: readonly OfferingCandidate[],
  query: ParsedOfferingsQuery,
): { items: OfferingCandidate[]; nextCursor?: string; hasMore: boolean } {
  const fingerprint = queryFingerprint(query);
  const cursor = decodeOfferingsCursor(query.cursor);
  if (cursor && cursor.fingerprint !== fingerprint) {
    throw new ValidationError('Cursor does not match filters');
  }
  if (cursor && cursor.tuple.length !== query.sorts.length + 1) {
    throw new ValidationError('Invalid offerings cursor');
  }

  const visible = cursor
    ? items.filter((item) => isAfterSortTuple(item, cursor.tuple, query.sorts))
    : [...items];
  const page = visible.slice(0, query.limit);
  const hasMore = visible.length > query.limit;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeOfferingsCursor({
      version: 1,
      fingerprint,
      tuple: sortTuple(last, query.sorts),
    })
    : undefined;

  return { items: page, hasMore, nextCursor };
}

function isCursor(value: unknown): value is OfferingsCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const cursor = value as Partial<OfferingsCursor>;
  return cursor.version === 1
    && typeof cursor.fingerprint === 'string'
    && /^[a-f0-9]{64}$/.test(cursor.fingerprint)
    && Array.isArray(cursor.tuple)
    && cursor.tuple.length >= 2
    && cursor.tuple.length <= 4
    && cursor.tuple.every((entry) => typeof entry === 'string' || typeof entry === 'number');
}
