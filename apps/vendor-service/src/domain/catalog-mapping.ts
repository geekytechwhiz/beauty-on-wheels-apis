import { ValidationError } from '@api-hub/utils';

export const MAX_CATALOG_MAPPINGS = 50;

const CATALOG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface ServiceOfferingInput {
  serviceId: string;
  categoryId: string;
  enabled?: boolean;
  priceOverride?: number;
}

export interface PackageOfferingInput {
  packageId: string;
  enabled?: boolean;
  priceOverride?: number;
}

export function isCatalogId(value: string): boolean {
  return CATALOG_ID_PATTERN.test(value);
}

export function assertMoneyAmount(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative number`);
  }
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-6) {
    throw new ValidationError(`${field} supports at most two decimal places`);
  }
}

export function findDuplicateId(ids: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return id;
    }
    seen.add(id);
  }
  return undefined;
}
