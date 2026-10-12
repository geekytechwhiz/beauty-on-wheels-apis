import { env } from '../configs/env.config';
import {
  CatalogOffering,
  CatalogPrice,
} from '../domain/create-booking';
import { BookingError } from '../errors';
import { authHeaders, requestJson, requireBaseUrl } from './http';

export interface CatalogGateway {
  getOffering(offeringId: string, authorizationHeader?: string): Promise<CatalogOffering>;
  priceOffering(input: {
    offeringId: string;
    vendorId: string;
    vehicleType: string;
    authorizationHeader?: string;
  }): Promise<CatalogPrice>;
}

export class HttpCatalogGateway implements CatalogGateway {
  async getOffering(offeringId: string, authorizationHeader?: string): Promise<CatalogOffering> {
    const base = requireBaseUrl(env.CATALOG_SERVICE_URL, 'CATALOG_SERVICE_URL');
    const body = await requestJson(
      `${base}/services/${encodeURIComponent(offeringId)}`,
      { method: 'GET', headers: authHeaders(authorizationHeader) },
    );
    return parseOffering(body, offeringId);
  }

  async priceOffering(input: {
    offeringId: string;
    vendorId: string;
    vehicleType: string;
    authorizationHeader?: string;
  }): Promise<CatalogPrice> {
    const base = requireBaseUrl(env.CATALOG_SERVICE_URL, 'CATALOG_SERVICE_URL');
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
      }),
    });
    return parsePrice(body, input.offeringId);
  }
}

export function parseOffering(body: unknown, offeringId: string): CatalogOffering {
  const record = asRecord(body);
  const id = typeof record.id === 'string' ? record.id : offeringId;
  if (typeof record.active !== 'boolean') {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog offering did not include an active flag',
      502,
    );
  }
  const vehicleTypes = Array.isArray(record.vehicleTypes)
    ? record.vehicleTypes.filter((value): value is string => typeof value === 'string')
    : [];
  const version = typeof record.version === 'number' && Number.isInteger(record.version)
    ? record.version
    : undefined;
  return {
    id,
    active: record.active,
    vehicleTypes,
    ...(version === undefined ? {} : { version }),
    ...(typeof record.currency === 'string' ? { currency: record.currency } : {}),
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
