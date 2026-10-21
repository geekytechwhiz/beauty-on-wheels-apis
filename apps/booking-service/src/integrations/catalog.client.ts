import { env } from '../configs/env.config';
import {
  CatalogOffering,
  CatalogPrice,
  VehiclePricing,
} from '../domain/create-booking';
import { BookingError } from '../errors';
import { authHeaders, requestJson, requireBaseUrl } from './http';

export interface CatalogGateway {
  getOffering(input: {
    offeringId: string;
    vendorId: string;
    authorizationHeader?: string;
  }): Promise<CatalogOffering>;
  priceOffering(input: {
    offeringId: string;
    vendorId: string;
    vehicleType: string;
    addOnIds: string[];
    authorizationHeader?: string;
  }): Promise<CatalogPrice>;
}

export class HttpCatalogGateway implements CatalogGateway {
  async getOffering(input: {
    offeringId: string;
    vendorId: string;
    authorizationHeader?: string;
  }): Promise<CatalogOffering> {
    const base = requireBaseUrl(env.CATALOG_BASE_URL, 'CATALOG_BASE_URL');
    const body = await requestJson(
      `${base}/services/${encodeURIComponent(input.offeringId)}?vendorId=${encodeURIComponent(input.vendorId)}`,
      { method: 'GET', headers: authHeaders(input.authorizationHeader) },
    );
    return parseOffering(body, input.offeringId);
  }

  async priceOffering(input: {
    offeringId: string;
    vendorId: string;
    vehicleType: string;
    addOnIds: string[];
    authorizationHeader?: string;
  }): Promise<CatalogPrice> {
    const base = requireBaseUrl(env.CATALOG_BASE_URL, 'CATALOG_BASE_URL');
    const body = await requestJson(`${base}/pricing/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.authorizationHeader ? { Authorization: input.authorizationHeader } : {}),
      },
      body: JSON.stringify({
        vendorId: input.vendorId,
        vehicleType: input.vehicleType,
        serviceIds: [input.offeringId],
        addOnIds: input.addOnIds,
      }),
    });
    return parsePrice(body, input.offeringId);
  }
}


export function parseOffering(
  body: unknown,
  offeringId: string,
): CatalogOffering {
  // Support both the standard API envelope and direct records.
  const response = asRecord(body);
  const record = asRecord(response.data !== undefined ? response.data : body);

  const id = typeof record.id === 'string' ? record.id : offeringId;

  if (typeof record.active !== 'boolean') {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog offering did not include an active flag',
      502,
    );
  }

  // Parse vehicle-specific pricing and duration.
  const vehiclePricing: VehiclePricing[] = [];

  if (Array.isArray(record.vehiclePricing)) {
    const seenTypes = new Set<string>();

    for (const entry of record.vehiclePricing) {
      const item = asRecord(entry);

      const vehicleType = item.vehicleType;
      const price = item.price;
      const durationMinutes = item.durationMinutes;

      if (
        typeof vehicleType !== 'string' ||
        vehicleType.trim().length === 0 ||
        seenTypes.has(vehicleType) ||
        typeof price !== 'number' ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(Math.round(price * 100)) ||
        typeof durationMinutes !== 'number' ||
        !Number.isInteger(durationMinutes) ||
        durationMinutes <= 0
      ) {
        throw new BookingError(
          'CATALOG_PRICING_UNAVAILABLE',
          'Service Catalog returned invalid vehicle pricing',
          502,
        );
      }

      seenTypes.add(vehicleType);

      vehiclePricing.push({
        vehicleType,
        price,
        durationMinutes,
      });
    }
  }

  // Backward compatibility for legacy Catalog records.
  const legacyVehicleTypes = Array.isArray(record.vehicleTypes)
    ? record.vehicleTypes.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  if (vehiclePricing.length === 0) {
    const basePrice = record.basePrice;
    const durationMinutes = record.durationMinutes;

    if (
      legacyVehicleTypes.length === 0 ||
      typeof basePrice !== 'number' ||
      !Number.isFinite(basePrice) ||
      basePrice < 0 ||
      typeof durationMinutes !== 'number' ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0
    ) {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Service Catalog did not provide valid vehicle pricing',
        502,
      );
    }

    for (const vehicleType of legacyVehicleTypes) {
      vehiclePricing.push({
        vehicleType,
        price: basePrice,
        durationMinutes,
      });
    }
  }

  const vehicleTypes = vehiclePricing.map((entry) => entry.vehicleType);

  const version =
    typeof record.version === 'number' && Number.isInteger(record.version)
      ? record.version
      : undefined;

  return {
    id,
    active: record.active,
    vehicleTypes,
    vehiclePricing,

    ...(version !== undefined ? { version } : {}),
    ...(typeof record.currency === 'string'
      ? { currency: record.currency }
      : {}),
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.categoryId === 'string'
      ? { categoryId: record.categoryId }
      : {}),
    ...(typeof record.vendorId === 'string'
      ? { vendorId: record.vendorId }
      : {}),

    // Only expose a single duration when all vehicle
    // types genuinely share the same duration.
    ...(vehiclePricing.every(
      (entry) => entry.durationMinutes === vehiclePricing[0].durationMinutes,
    )
      ? {
          durationMinutes: vehiclePricing[0].durationMinutes,
        }
      : {}),
  };
}


export function parsePrice(body: unknown, offeringId: string): CatalogPrice {
  const record = asRecord(body);
  const items = Array.isArray(record.items) ? record.items : [];
  const line = items
    .map(asRecord)
    .find((item) => item.id === offeringId);
  const unitPrice = line && typeof line.unitPrice === 'number' ? line.unitPrice : undefined;
  const version = integerOrUndefined(record.offeringVersion) ?? integerOrUndefined(record.version);
  const catalogVersion = integerOrUndefined(record.catalogVersion);
  const vendorPricingVersion = nonNegativeIntegerOrUndefined(record.vendorPricingVersion);
  return {
    currency: typeof record.currency === 'string' ? record.currency : '',
    subtotal: numberOrNaN(record.subtotal),
    discount: numberOrNaN(record.discount),
    addOnTotal: numberOrNaN(record.addOnTotal),
    total: numberOrNaN(record.total),
    ...(typeof record.taxAmount === 'number' ? { taxAmount: record.taxAmount } : {}),
    ...(unitPrice === undefined ? {} : { unitPrice }),
    ...(version === undefined ? {} : { offeringVersion: version, version }),
    ...(catalogVersion === undefined ? {} : { catalogVersion }),
    ...(vendorPricingVersion === undefined ? {} : { vendorPricingVersion }),
    items: items.map(asRecord).flatMap((item) => {
      const id = typeof item.id === 'string' ? item.id : undefined;
      const name = typeof item.name === 'string' ? item.name : undefined;
      const type = item.type;
      const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : undefined;
      const total = typeof item.total === 'number' ? item.total : undefined;
      return id && name && (type === 'SERVICE' || type === 'PACKAGE' || type === 'ADD_ON') && unitPrice !== undefined && total !== undefined
        ? [{ id, name, type, unitPrice, total }]
        : [];
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned an unreadable offering',
      502,
    );
  }
  return value as Record<string, unknown>;
}

function numberOrNaN(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function nonNegativeIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

let gateway: CatalogGateway | undefined;

export function getCatalogGateway(): CatalogGateway {
  if (!gateway) {
    gateway = new HttpCatalogGateway();
  }
  return gateway;
}
