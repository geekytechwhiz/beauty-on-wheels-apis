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

/** Vendor-owned catalog package with its composition, as read from `GET /packages/{packageId}`. */
export interface CatalogPackage {
  id: string;
  vendorId: string;
  name: string;
  active: boolean;
  /** Catalog integer amount (INR rupees), the same convention as booking prices. */
  discountedPrice: number;
  currency: string;
  version?: number;
  items: Array<{ refId: string; itemType: 'SERVICE' | 'ADDON'; quantity?: number }>;
}

export interface CatalogPackageGateway {
  getPackage(input: {
    packageId: string;
    vendorId: string;
    authorizationHeader?: string;
  }): Promise<CatalogPackage>;
}

export class HttpCatalogGateway implements CatalogGateway, CatalogPackageGateway {
  async getPackage(input: {
    packageId: string;
    vendorId: string;
    authorizationHeader?: string;
  }): Promise<CatalogPackage> {
    const base = requireBaseUrl(env.CATALOG_BASE_URL, 'CATALOG_BASE_URL');
    try {
      const body = await requestJson(
        `${base}/packages/${encodeURIComponent(input.packageId)}?vendorId=${encodeURIComponent(input.vendorId)}`,
        { method: 'GET', headers: authHeaders(input.authorizationHeader) },
      );
      return parsePackage(body, input.packageId);
    } catch (error) {
      if (error instanceof BookingError && error.statusCode === 404) {
        throw new BookingError('PACKAGE_NOT_FOUND', 'Package not found for the vendor', 404, 'packageId', false);
      }
      throw error;
    }
  }

  async getOffering(input: {
    offeringId: string;
    vendorId: string;
    authorizationHeader?: string;
  }): Promise<CatalogOffering> {
    const base = requireBaseUrl(env.CATALOG_BASE_URL, 'CATALOG_BASE_URL');
    const body = await requestJson(
      `${base}/services/${encodeURIComponent(input.offeringId)}?vendorId=${encodeURIComponent(input.vendorId)}&consistent=true`,
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


export function parsePackage(body: unknown, packageId: string): CatalogPackage {
  const response = asRecord(body);
  const record = asRecord(response.data !== undefined ? response.data : body);
  const id = typeof record.id === 'string' ? record.id : packageId;
  const unavailable = (message: string) => new BookingError('CATALOG_PRICING_UNAVAILABLE', message, 502);
  if (typeof record.active !== 'boolean') throw unavailable('Service Catalog package did not include an active flag');
  if (typeof record.vendorId !== 'string' || !record.vendorId.trim()) {
    throw unavailable('Service Catalog package did not include a vendor');
  }
  const price = record.discountedPrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    throw unavailable('Service Catalog package did not include a valid price');
  }
  if (!Array.isArray(record.items)) throw unavailable('Service Catalog package did not include items');
  const items = record.items.map((entry) => {
    const item = asRecord(entry);
    if (typeof item.refId !== 'string' || !item.refId.trim() || (item.itemType !== 'SERVICE' && item.itemType !== 'ADDON')) {
      throw unavailable('Service Catalog package returned an invalid item');
    }
    return {
      refId: item.refId,
      itemType: item.itemType as 'SERVICE' | 'ADDON',
      ...(typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0
        ? { quantity: item.quantity } : {}),
    };
  });
  return {
    id,
    vendorId: record.vendorId,
    name: typeof record.name === 'string' ? record.name : id,
    active: record.active,
    discountedPrice: price,
    currency: typeof record.currency === 'string' && /^[A-Za-z]{3}$/.test(record.currency) ? record.currency.toUpperCase() : 'INR',
    ...(typeof record.version === 'number' && Number.isInteger(record.version) ? { version: record.version } : {}),
    items,
  };
}

export function parseOffering(
  body: unknown,
  offeringId: string,
): CatalogOffering {
  // Support both the standard API envelope and direct records.
  const response = asRecord(body);
  const record = asRecord(response.data !== undefined ? response.data : body);

  const id = typeof record.id === 'string' ? record.id : offeringId;

  const communities = parseCommunities(record.communities);

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
    ...(communities ? { communities } : {}),

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


function parseCommunities(
  value: unknown,
): Array<{ communityId: string; status: string; approvalStatus?: string }> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned an invalid community list',
      502,
    );
  }
  return value.map((entry) => {
    const item = asRecord(entry);
    if (typeof item.communityId !== 'string' || typeof item.status !== 'string') {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Service Catalog returned an invalid community mapping',
        502,
      );
    }
    if (
      item.approvalStatus !== undefined
      && item.approvalStatus !== 'pending'
      && item.approvalStatus !== 'approved'
      && item.approvalStatus !== 'rejected'
    ) {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Service Catalog returned an invalid community approval status',
        502,
      );
    }
    return {
      communityId: item.communityId,
      status: item.status,
      ...(typeof item.approvalStatus === 'string' ? { approvalStatus: item.approvalStatus } : {}),
    };
  });
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

let gateway: HttpCatalogGateway | undefined;

export function getCatalogGateway(): CatalogGateway {
  return getHttpCatalogGateway();
}

export function getCatalogPackageGateway(): CatalogPackageGateway {
  return getHttpCatalogGateway();
}

function getHttpCatalogGateway(): HttpCatalogGateway {
  if (!gateway) {
    gateway = new HttpCatalogGateway();
  }
  return gateway;
}
