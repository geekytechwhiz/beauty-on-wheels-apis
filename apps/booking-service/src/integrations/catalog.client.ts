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

export interface CatalogPackageVisitWindow {
  visitWindowId: string;
  label: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface CatalogPackageIncludedService {
  name: string;
  description?: string;
  categoryId: string;
  tags?: string[];
  /** Stable entitlement id when provided by catalog. */
  serviceKey?: string;
  visitsPerPeriod: number;
  durationMinutes: number;
}

export interface CatalogPackageEntitlement {
  serviceId: string;
  quantity: number;
  name?: string;
  durationMinutes?: number;
  categoryId?: string;
}

export interface CatalogPackageVehiclePrice {
  vehicleType: string;
  /** Catalog integer amount (INR rupees), same convention as booking prices. */
  price: number;
  /** Total package duration across visits in the billing period for this vehicle. */
  durationMinutes: number;
}

/** Vendor-owned catalog package with its composition, as read from offering detail. */
export interface CatalogPackage {
  id: string;
  vendorId: string;
  name: string;
  description?: string;
  active: boolean;
  billingPeriod: 'oneTime' | 'weekly' | 'monthly' | 'yearly';
  /** Catalog integer amount (INR rupees) for the selected or first vehicle price. */
  discountedPrice: number;
  currency: string;
  version?: number;
  vehiclePricing: CatalogPackageVehiclePrice[];
  vehicleTypes: string[];
  includedServices: CatalogPackageIncludedService[];
  visitWindows: CatalogPackageVisitWindow[];
  /** Authoritative entitlement list from offering detail when present. */
  entitlements?: CatalogPackageEntitlement[];
  /** Purchase validity window in days (snapshotted onto the plan). */
  validityDays?: number;
  items: Array<{ refId: string; itemType: 'SERVICE' | 'ADDON'; quantity?: number }>;
  /** Community eligibility mappings from offering detail. */
  communities?: Array<{ communityId: string; status: string; approvalStatus?: string }>;
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
        `${base}/offerings/${encodeURIComponent(input.packageId)}?consistent=true`,
        { method: 'GET', headers: authHeaders(input.authorizationHeader) },
      );
      return parsePackageFromOffering(body, input.packageId, input.vendorId);
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
      `${base}/offerings/${encodeURIComponent(input.offeringId)}?consistent=true`,
      { method: 'GET', headers: authHeaders(input.authorizationHeader) },
    );
    return parseOffering(body, input.offeringId, input.vendorId);
  }

  async priceOffering(input: {
    offeringId: string;
    vendorId: string;
    vehicleType: string;
    addOnIds: string[];
    authorizationHeader?: string;
  }): Promise<CatalogPrice> {
    // Pricing is derived from the offering vehicle price. Catalog no longer
    // exposes POST /pricing/calculate. Add-ons are not part of the unified offering model.
    if (input.addOnIds.length > 0) {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Add-on pricing is not supported on catalog offerings',
        502,
      );
    }
    const offering = await this.getOffering({
      offeringId: input.offeringId,
      vendorId: input.vendorId,
      authorizationHeader: input.authorizationHeader,
    });
    const match = offering.vehiclePricing.find((entry) => entry.vehicleType === input.vehicleType);
    if (!match) {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        `Vehicle type ${input.vehicleType} is not supported on this offering`,
        400,
      );
    }
    const unitPrice = match.price;
    const version = offering.version;
    return {
      currency: offering.currency ?? 'INR',
      subtotal: unitPrice,
      discount: 0,
      addOnTotal: 0,
      total: unitPrice,
      unitPrice,
      ...(version === undefined ? {} : { offeringVersion: version, version, catalogVersion: version }),
      items: [{
        id: offering.id,
        name: offering.name ?? offering.id,
        type: 'PACKAGE',
        unitPrice,
        total: unitPrice,
      }],
    };
  }
}


export function parsePackageFromOffering(body: unknown, packageId: string, vendorId: string): CatalogPackage {
  const offering = parseOffering(body, packageId, vendorId);
  if (!offering.active) {
    throw new BookingError('PACKAGE_NOT_FOUND', 'Package not found for the vendor', 404, 'packageId', false);
  }
  if (offering.vendorId && offering.vendorId !== vendorId) {
    throw new BookingError('PACKAGE_NOT_FOUND', 'Package not found for the vendor', 404, 'packageId', false);
  }
  const response = asRecord(body);
  const record = asRecord(response.data !== undefined ? response.data : body);
  const status = typeof record.status === 'string' ? record.status : undefined;
  if (status && status !== 'published') {
    throw new BookingError('PACKAGE_INACTIVE', 'Package is not active', 409, 'packageId', false);
  }

  const includedServices = parseIncludedServices(record.includedServices);
  const items = includedServices.map((entry) => ({
    refId: entry.serviceKey ?? entry.name,
    itemType: 'SERVICE' as const,
    quantity: entry.visitsPerPeriod,
  }));
  const vehiclePricing = offering.vehiclePricing.map((entry) => ({
    vehicleType: entry.vehicleType,
    price: entry.price,
    durationMinutes: entry.durationMinutes,
  }));
  if (vehiclePricing.length === 0) {
    throw new BookingError('CATALOG_PRICING_UNAVAILABLE', 'Service Catalog package did not include a valid price', 502);
  }
  const billingPeriod = parseBillingPeriod(record.billingPeriod);
  const visitWindows = parseVisitWindows(record.visitWindows);
  const entitlements = parseEntitlements(record.entitlements);
  const validityDays = typeof record.validityDays === 'number'
    && Number.isInteger(record.validityDays)
    && record.validityDays >= 1
    ? record.validityDays
    : undefined;

  return {
    id: offering.id,
    vendorId: offering.vendorId ?? vendorId,
    name: offering.name ?? packageId,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    active: offering.active,
    billingPeriod,
    discountedPrice: vehiclePricing[0].price,
    currency: offering.currency ?? 'INR',
    ...(offering.version !== undefined ? { version: offering.version } : {}),
    vehiclePricing,
    vehicleTypes: vehiclePricing.map((entry) => entry.vehicleType),
    includedServices,
    visitWindows,
    ...(entitlements.length > 0 ? { entitlements } : {}),
    ...(validityDays === undefined ? {} : { validityDays }),
    items: items.length > 0 ? items : [{ refId: offering.id, itemType: 'SERVICE' }],
    ...(offering.communities ? { communities: offering.communities } : {}),
  };
}

function parseBillingPeriod(value: unknown): CatalogPackage['billingPeriod'] {
  if (value === 'oneTime' || value === 'weekly' || value === 'monthly' || value === 'yearly') {
    return value;
  }
  // Legacy bridged packages without billingPeriod default to oneTime.
  return 'oneTime';
}

function parseIncludedServices(value: unknown): CatalogPackageIncludedService[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => {
    const item = asRecord(entry);
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : `item-${index + 1}`;
    const visitsPerPeriod = typeof item.visitsPerPeriod === 'number'
      && Number.isInteger(item.visitsPerPeriod)
      && item.visitsPerPeriod > 0
      ? item.visitsPerPeriod
      : 1;
    const durationMinutes = typeof item.durationMinutes === 'number'
      && Number.isInteger(item.durationMinutes)
      && item.durationMinutes > 0
      ? item.durationMinutes
      : 1;
    const categoryId = typeof item.categoryId === 'string' && item.categoryId.trim()
      ? item.categoryId.trim()
      : 'unknown';
    const serviceKey = typeof item.serviceKey === 'string' && item.serviceKey.trim()
      ? item.serviceKey.trim()
      : undefined;
    return {
      name,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      categoryId,
      ...(Array.isArray(item.tags)
        ? { tags: item.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) }
        : {}),
      ...(serviceKey === undefined ? {} : { serviceKey }),
      visitsPerPeriod,
      durationMinutes,
    };
  });
}

function parseEntitlements(value: unknown): CatalogPackageEntitlement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const serviceId = typeof item.serviceId === 'string' ? item.serviceId.trim() : '';
    const quantity = typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0
      ? item.quantity
      : 0;
    if (!serviceId || quantity < 1) return [];
    return [{
      serviceId,
      quantity,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.durationMinutes === 'number' ? { durationMinutes: item.durationMinutes } : {}),
      ...(typeof item.categoryId === 'string' ? { categoryId: item.categoryId } : {}),
    }];
  });
}

function parseVisitWindows(value: unknown): CatalogPackageVisitWindow[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned invalid visit windows',
      502,
    );
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = asRecord(entry);
    const visitWindowId = typeof item.visitWindowId === 'string' ? item.visitWindowId.trim() : '';
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!visitWindowId || !label || seen.has(visitWindowId)) {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Service Catalog returned invalid visit windows',
        502,
      );
    }
    seen.add(visitWindowId);
    if (item.allDay === true) {
      return { visitWindowId, label, allDay: true };
    }
    if (typeof item.startTime !== 'string' || typeof item.endTime !== 'string') {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Service Catalog returned invalid visit windows',
        502,
      );
    }
    return {
      visitWindowId,
      label,
      startTime: item.startTime,
      endTime: item.endTime,
    };
  });
}

export function parseOffering(
  body: unknown,
  offeringId: string,
  expectedVendorId?: string,
): CatalogOffering {
  // Support both the standard API envelope and direct records.
  const response = asRecord(body);
  const record = asRecord(response.data !== undefined ? response.data : body);

  const id = typeof record.offeringId === 'string'
    ? record.offeringId
    : typeof record.id === 'string'
      ? record.id
      : offeringId;

  const communities = parseCommunities(record.communities);

  const active = typeof record.active === 'boolean'
    ? record.active
    : record.status === 'published';

  if (typeof active !== 'boolean') {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog offering did not include an active flag',
      502,
    );
  }

  if (expectedVendorId && typeof record.vendorId === 'string' && record.vendorId !== expectedVendorId) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog offering vendor mismatch',
      404,
    );
  }

  // Parse vehicle-specific pricing. New offerings use integer minor units;
  // legacy bridged rows may still send major units with at most two decimals.
  const vehiclePricing: VehiclePricing[] = [];
  const pricesAreMinor = record.offeringType === 'PACKAGE'
    || record.offeringType === 'SERVICE'
    || typeof record.billingPeriod === 'string';

  if (Array.isArray(record.vehiclePricing)) {
    const seenTypes = new Set<string>();

    for (const entry of record.vehiclePricing) {
      const item = asRecord(entry);

      const vehicleType = item.vehicleType;
      const rawPrice = item.price;
      const durationMinutes = item.durationMinutes;

      if (
        typeof vehicleType !== 'string'
        || vehicleType.trim().length === 0
        || seenTypes.has(vehicleType)
        || typeof rawPrice !== 'number'
        || !Number.isFinite(rawPrice)
        || rawPrice < 0
        || typeof durationMinutes !== 'number'
        || !Number.isInteger(durationMinutes)
        || durationMinutes <= 0
      ) {
        throw new BookingError(
          'CATALOG_PRICING_UNAVAILABLE',
          'Service Catalog returned invalid vehicle pricing',
          502,
        );
      }

      const price = pricesAreMinor
        ? minorToMajor(rawPrice)
        : majorOrThrow(rawPrice);

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
      legacyVehicleTypes.length === 0
      || typeof basePrice !== 'number'
      || !Number.isFinite(basePrice)
      || basePrice < 0
      || typeof durationMinutes !== 'number'
      || !Number.isInteger(durationMinutes)
      || durationMinutes <= 0
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
        price: pricesAreMinor ? minorToMajor(basePrice) : basePrice,
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
    active,

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

function minorToMajor(paise: number): number {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned invalid minor-unit price',
      502,
    );
  }
  return Math.round(paise) / 100;
}

function majorOrThrow(value: number): number {
  if (!Number.isInteger(Math.round(value * 100))) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned invalid vehicle pricing',
      502,
    );
  }
  return value;
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
