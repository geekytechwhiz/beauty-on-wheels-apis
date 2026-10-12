import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { AvailabilityErrors } from '../errors';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_RANGE_DAYS,
} from '../domain/constants';
import { civilDatesInclusive, isValidDate } from '../domain/time';
import { requirePathId } from '../auth/access';

export function pathParam(request: LambdaRequest, name: string): string {
  const value =
    request.pathParameters?.[name] ??
    (request.params?.[name] as string | undefined);
  if (!value || !value.trim()) {
    throw new ValidationError(`${name} is required`);
  }
  return requirePathId(value, name);
}

export function queryValue(request: LambdaRequest, name: string): string | undefined {
  const params = request.params ?? {};
  const fromParams = params[name];
  if (typeof fromParams === 'string' && fromParams.trim()) {
    return fromParams.trim();
  }
  const fromQuery = request.event?.queryStringParameters?.[name];
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return fromQuery.trim();
  }
  return undefined;
}

export function headerValue(request: LambdaRequest, name: string): string | undefined {
  const headers = request.event?.headers ?? {};
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function parseLimit(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_LIST_LIMIT;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new ValidationError(
      `limit must be an integer between 1 and ${MAX_LIST_LIMIT}`,
    );
  }
  return limit;
}

export function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new ValidationError('Expected a boolean query value');
}

export interface DateRange {
  fromDate: string;
  toDate: string;
  dates: string[];
}

export function parseDateRange(request: LambdaRequest): DateRange {
  const date = queryValue(request, 'date');
  const fromDate = queryValue(request, 'fromDate') ?? date;
  const toDate = queryValue(request, 'toDate') ?? date ?? fromDate;

  if (!fromDate || !toDate) {
    throw new ValidationError('date or fromDate and toDate is required');
  }
  if (!isValidDate(fromDate) || !isValidDate(toDate)) {
    throw AvailabilityErrors.invalidDateRange('Dates must be YYYY-MM-DD');
  }
  if (fromDate > toDate) {
    throw AvailabilityErrors.invalidDateRange('fromDate must be on or before toDate');
  }
  const dates = civilDatesInclusive(fromDate, toDate);
  if (dates.length > MAX_RANGE_DAYS || dates[dates.length - 1] < toDate) {
    throw AvailabilityErrors.invalidDateRange(
      `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
    );
  }
  return { fromDate, toDate, dates };
}

export function decodeCursor(raw: string | undefined): { date: string; startTime: string } | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      date?: string;
      startTime?: string;
    };
    if (!parsed.date || !parsed.startTime || !isValidDate(parsed.date)) {
      throw new Error('invalid');
    }
    return { date: parsed.date, startTime: parsed.startTime };
  } catch {
    throw new ValidationError('cursor is invalid');
  }
}

export function encodeCursor(date: string, startTime: string): string {
  return Buffer.from(JSON.stringify({ date, startTime }), 'utf8').toString('base64url');
}
