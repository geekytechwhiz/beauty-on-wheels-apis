import { ValidationError } from '@api-hub/utils';

import type { VendorHomeQuery } from './vendor-home.types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_UPCOMING_DAYS = 3;
const VENDOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function assertVendorId(vendorId: string | undefined): string {
  const value = vendorId?.trim() ?? '';
  if (!value || !VENDOR_ID_PATTERN.test(value)) {
    throw new ValidationError('vendorId is invalid');
  }
  return value;
}

export function parseVendorHomeQuery(
  params: Record<string, unknown> | undefined,
): VendorHomeQuery {
  const dateRaw = text(params?.date);
  if (dateRaw !== undefined) {
    assertCivilDate(dateRaw, 'date');
  }

  const upcomingRaw = params?.upcomingDays;
  let upcomingDays = DEFAULT_UPCOMING_DAYS;
  if (upcomingRaw !== undefined && upcomingRaw !== null && upcomingRaw !== '') {
    const parsed = Number(upcomingRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
      throw new ValidationError('upcomingDays must be an integer from 1 to 7');
    }
    upcomingDays = parsed;
  }

  return {
    ...(dateRaw ? { date: dateRaw } : {}),
    upcomingDays,
  };
}

function assertCivilDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !DATE_PATTERN.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
