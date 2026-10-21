import { ValidationError } from '@api-hub/utils';

import { isValidDate, isValidTime } from './time';

export const MAX_BOOKABLE_BRANCHES = 40;
export const MAX_BOOKABLE_OFFERINGS = 500;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface BookableVehicleProbe {
  vehicleType: string;
  durationMinutes: number;
}

export interface BookableOfferingProbe {
  vendorId: string;
  branchId: string;
  offeringId: string;
  vehicles: BookableVehicleProbe[];
}

export interface BookableOfferingsQuery {
  date: string;
  startTime?: string;
  offerings: BookableOfferingProbe[];
}

export function parseBookableOfferingsQuery(event: unknown): BookableOfferingsQuery {
  const source = isRecord(event) ? event : undefined;
  if (!source) {
    throw new ValidationError('Availability request is invalid');
  }
  const date = requiredText(source.date, 'date');
  if (!isValidDate(date)) {
    throw new ValidationError('date must be YYYY-MM-DD');
  }
  const startTime = optionalText(source.startTime);
  if (startTime && !isValidTime(startTime)) {
    throw new ValidationError('startTime must be HH:mm');
  }
  if (!Array.isArray(source.offerings)) {
    throw new ValidationError('offerings is required');
  }
  if (source.offerings.length > MAX_BOOKABLE_OFFERINGS) {
    throw new ValidationError('Availability filter is too broad');
  }

  const offerings = source.offerings.map((entry) => parseProbe(entry));
  const branches = new Set(offerings.map((offering) => `${offering.vendorId}#${offering.branchId}`));
  if (branches.size > MAX_BOOKABLE_BRANCHES) {
    throw new ValidationError('Availability filter is too broad');
  }

  return {
    date,
    ...(startTime ? { startTime } : {}),
    offerings,
  };
}

function parseProbe(value: unknown): BookableOfferingProbe {
  const record = isRecord(value) ? value : undefined;
  if (!record) {
    throw new ValidationError('offering is invalid');
  }
  if (!Array.isArray(record.vehicles) || record.vehicles.length === 0 || record.vehicles.length > 10) {
    throw new ValidationError('vehicles is required');
  }
  return {
    vendorId: requireId(record.vendorId, 'vendorId'),
    branchId: requireId(record.branchId, 'branchId'),
    offeringId: requireId(record.offeringId, 'offeringId'),
    vehicles: record.vehicles.map((entry) => parseVehicle(entry)),
  };
}

function parseVehicle(value: unknown): BookableVehicleProbe {
  const record = isRecord(value) ? value : undefined;
  if (!record) {
    throw new ValidationError('vehicle is invalid');
  }
  const vehicleType = requireId(record.vehicleType, 'vehicleType');
  const durationMinutes = record.durationMinutes;
  if (!Number.isInteger(durationMinutes) || (durationMinutes as number) < 1 || (durationMinutes as number) > 24 * 60) {
    throw new ValidationError('durationMinutes must be a positive integer');
  }
  return {
    vehicleType,
    durationMinutes: durationMinutes as number,
  };
}

function requireId(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!ID_PATTERN.test(text)) {
    throw new ValidationError(`${field} is invalid`);
  }
  return text;
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) {
    throw new ValidationError(`${field} is required`);
  }
  return text;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Availability request is invalid');
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
