import { BaseError, isVehicleType, type VehicleType } from '@api-hub/utils';

const PAISE_SCALE = 100;
const DECIMAL_TOLERANCE = 1e-6;

export function assertCatalogAmount(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new BaseError(
      `${field} must be a non-negative amount`,
      400,
      'INVALID_PRICE',
    );
  }
  const paise = Math.round(value * PAISE_SCALE);
  if (Math.abs(value * PAISE_SCALE - paise) > DECIMAL_TOLERANCE) {
    throw new BaseError(
      `${field} supports at most two decimal places`,
      400,
      'INVALID_PRICE',
    );
  }
  return paise;
}

export function rupeesToPaise(value: number, field: string): number {
  return assertCatalogAmount(value, field);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / PAISE_SCALE;
}

export function assertPositiveDuration(durationMinutes: number): void {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new BaseError(
      'durationMinutes must be a positive integer',
      400,
      'VALIDATION_ERROR',
    );
  }
}

export function assertCatalogName(name: string, field = 'name'): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) {
    throw new BaseError(
      `${field} must be between 1 and 100 characters`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return trimmed;
}

export function assertVehicleTypes(values: readonly string[]): VehicleType[] {
  if (values.length === 0) {
    throw new BaseError(
      'at least one vehicleType is required',
      400,
      'INVALID_VEHICLE_TYPE',
    );
  }
  const seen = new Set<string>();
  const canonical: VehicleType[] = [];
  for (const value of values) {
    if (!isVehicleType(value)) {
      throw new BaseError(
        `Invalid vehicle type: ${value}`,
        400,
        'INVALID_VEHICLE_TYPE',
      );
    }
    if (seen.has(value)) {
      throw new BaseError(
        `Duplicate vehicle type: ${value}`,
        400,
        'VALIDATION_ERROR',
      );
    }
    seen.add(value);
    canonical.push(value);
  }
  return canonical;
}

export function assertVehicleType(value: string): VehicleType {
  if (!isVehicleType(value)) {
    throw new BaseError(
      `Invalid vehicle type: ${value}`,
      400,
      'INVALID_VEHICLE_TYPE',
    );
  }
  return value;
}
