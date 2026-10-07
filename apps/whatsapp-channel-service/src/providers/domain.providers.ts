import { ChannelConfig } from '../config/env';
import { ChannelError, CHANNEL_ERROR_CODE } from '../errors/channel-error';
import { asItems, nextTokenOf, ServiceHttpClient, unwrapData } from '../infra/http-client';
import {
  Booking,
  CatalogService,
  Category,
  CouponValidation,
  PriceBreakdown,
  Slot,
  Vehicle,
  VendorSummary,
} from '../types/domain';

export interface CatalogClient {
  listCategories(): Promise<Category[]>;
  listServices(categoryId: string): Promise<CatalogService[]>;
  getService(categoryId: string, serviceId: string): Promise<CatalogService>;
}

export interface AvailabilityClient {
  slots(vendorId: string, date: string): Promise<Slot[]>;
  slot(slotId: string): Promise<Slot>;
}

export interface PricingClient {
  calculate(input: { vendorId: string; vehicleType: string; serviceIds: string[]; couponCode?: string }): Promise<PriceBreakdown>;
  validateCoupon(couponCode: string, vendorId: string): Promise<CouponValidation>;
}

export interface BookingClient {
  create(body: {
    customerId: string;
    vendorId: string;
    vehicleId: string;
    serviceIds: string[];
    bookingDate: string;
    slotId: string;
    totalAmount: number;
  }): Promise<Booking>;
  confirm(id: string): Promise<Booking>;
  cancel(id: string): Promise<Booking>;
  get(id: string): Promise<Booking>;
  listByCustomer(customerId: string): Promise<Booking[]>;
}

export interface UserClient {
  updateMarketingConsent(customerId: string, consent: boolean): Promise<void>;
}

export interface VehicleListResult {
  vehicles: Vehicle[];
  scoped: boolean;
}

export interface VehicleClient {
  listForCustomer(customerId: string): Promise<VehicleListResult>;
}

export interface VendorClient {
  listActive(limit: number): Promise<VendorSummary[]>;
  get(vendorId: string): Promise<VendorSummary>;
}

function http(config: ChannelConfig, dependency: string, baseUrl: string, token?: string): ServiceHttpClient {
  return new ServiceHttpClient({
    baseUrl,
    dependency,
    token,
    timeoutMs: config.downstreamTimeoutMs,
  });
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  let current = value;
  if (current && typeof current === 'object' && 'data' in current && !Array.isArray((current as { data?: unknown }).data)) {
    const nested = (current as { data?: unknown }).data;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) current = nested;
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new ChannelError(CHANNEL_ERROR_CODE.INTERNAL_ERROR, `Malformed ${label} response`);
  }
  return current as Record<string, unknown>;
}

export class HttpCatalogClient implements CatalogClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpCatalogClient {
    return new HttpCatalogClient(http(config, 'catalog', config.catalogServiceUrl, token));
  }

  async listCategories(): Promise<Category[]> {
    const collected: Category[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const path = `/categories?active=true&limit=10${token ? `&nextToken=${encodeURIComponent(token)}` : ''}`;
      const data = unwrapData(await this.client.get<unknown>(path));
      collected.push(...asItems<Record<string, unknown>>(data).map(toCategory).filter((item) => item.active !== false));
      token = nextTokenOf(data);
      if (!token) break;
    }
    return collected;
  }

  async listServices(categoryId: string): Promise<CatalogService[]> {
    const collected: CatalogService[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const path = `/services?categoryId=${encodeURIComponent(categoryId)}&active=true&limit=10${token ? `&nextToken=${encodeURIComponent(token)}` : ''}`;
      const data = unwrapData(await this.client.get<unknown>(path));
      collected.push(...asItems<Record<string, unknown>>(data).map(toService).filter((item) => item.active !== false));
      token = nextTokenOf(data);
      if (!token) break;
    }
    return collected;
  }

  async getService(categoryId: string, serviceId: string): Promise<CatalogService> {
    const data = unwrapData(await this.client.get<unknown>(
      `/services/${encodeURIComponent(serviceId)}?categoryId=${encodeURIComponent(categoryId)}`,
    ));
    return toService(asRecord(data, 'service'));
  }
}

export class HttpAvailabilityClient implements AvailabilityClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpAvailabilityClient {
    return new HttpAvailabilityClient(http(config, 'availability', config.availabilityServiceUrl, token));
  }

  async slots(vendorId: string, date: string): Promise<Slot[]> {
    const data = unwrapData(await this.client.get<unknown>(
      `/vendors/${encodeURIComponent(vendorId)}/slots?date=${encodeURIComponent(date)}`,
    ));
    return asItems<Record<string, unknown>>(data).map(toSlot).filter((slot) => slot.id);
  }

  async slot(slotId: string): Promise<Slot> {
    const data = unwrapData(await this.client.get<unknown>(`/slots/${encodeURIComponent(slotId)}`));
    return toSlot(asRecord(data, 'slot'));
  }
}

export class HttpPricingClient implements PricingClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpPricingClient {
    return new HttpPricingClient(http(config, 'pricing', config.pricingServiceUrl, token));
  }

  async calculate(input: { vendorId: string; vehicleType: string; serviceIds: string[]; couponCode?: string }): Promise<PriceBreakdown> {
    const data = unwrapData(await this.client.post<unknown>('/pricing/calculate', input, false));
    return toPrice(asRecord(data, 'price'));
  }

  async validateCoupon(couponCode: string, vendorId: string): Promise<CouponValidation> {
    const data = unwrapData(await this.client.post<unknown>('/pricing/validate-coupon', { couponCode, vendorId }, false));
    const record = asRecord(data, 'coupon');
    return { valid: record.valid !== false, reason: typeof record.reason === 'string' ? record.reason : undefined };
  }
}

export class HttpBookingClient implements BookingClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpBookingClient {
    return new HttpBookingClient(http(config, 'booking', config.bookingServiceUrl, token));
  }

  async create(body: {
    customerId: string;
    vendorId: string;
    vehicleId: string;
    serviceIds: string[];
    bookingDate: string;
    slotId: string;
    totalAmount: number;
  }): Promise<Booking> {
    const data = unwrapData(await this.client.post<unknown>('/bookings', {
      customerId: body.customerId,
      vendorId: body.vendorId,
      vehicleId: body.vehicleId,
      serviceIds: body.serviceIds,
      bookingDate: body.bookingDate,
      slotId: body.slotId,
      totalAmount: body.totalAmount,
      paymentStatus: 'PENDING',
      bookingStatus: 'CREATED',
    }, false));
    return toBooking(asRecord(data, 'booking'));
  }

  async confirm(id: string): Promise<Booking> {
    const data = unwrapData(await this.client.post<unknown>(`/bookings/${encodeURIComponent(id)}/confirm`, {}, false));
    return toBooking(asRecord(data, 'booking'));
  }

  async cancel(id: string): Promise<Booking> {
    const data = unwrapData(await this.client.post<unknown>(`/bookings/${encodeURIComponent(id)}/cancel`, {}, false));
    return toBooking(asRecord(data, 'booking'));
  }

  async get(id: string): Promise<Booking> {
    const data = unwrapData(await this.client.get<unknown>(`/bookings/${encodeURIComponent(id)}`));
    return toBooking(asRecord(data, 'booking'));
  }

  async listByCustomer(customerId: string): Promise<Booking[]> {
    const data = unwrapData(await this.client.get<unknown>(`/customers/${encodeURIComponent(customerId)}/bookings`));
    return asItems<Record<string, unknown>>(data).map(toBooking);
  }
}

export class HttpUserClient implements UserClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpUserClient {
    return new HttpUserClient(http(config, 'user', config.userServiceUrl, token));
  }

  async updateMarketingConsent(customerId: string, consent: boolean): Promise<void> {
    await this.client.put(`/customers/${encodeURIComponent(customerId)}`, { marketingConsent: consent });
  }
}

export class HttpVehicleClient implements VehicleClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpVehicleClient {
    return new HttpVehicleClient(http(config, 'vehicle', config.vehicleServiceUrl, token));
  }

  async listForCustomer(customerId: string): Promise<VehicleListResult> {
    const data = unwrapData(await this.client.get<unknown>('/vehicles'));
    const vehicles = asItems<Record<string, unknown>>(data).map(toVehicle).filter((vehicle) => vehicle.id);
    const owned = vehicles.filter((vehicle) => vehicle.userId === customerId);
    if (owned.length > 0) return { vehicles: owned, scoped: true };
    if (vehicles.length === 0) return { vehicles: [], scoped: true };
    return { vehicles: [], scoped: false };
  }
}

export class HttpVendorClient implements VendorClient {
  constructor(private readonly client: ServiceHttpClient) {}

  static fromConfig(config: ChannelConfig, token?: string): HttpVendorClient {
    return new HttpVendorClient(http(config, 'vendor', config.vendorServiceUrl, token));
  }

  async listActive(limit: number): Promise<VendorSummary[]> {
    const data = unwrapData(await this.client.get<unknown>(`/vendors?status=ACTIVE&limit=${limit}`));
    return asItems<Record<string, unknown>>(data).map(toVendor).filter((vendor) => vendor.vendorId);
  }

  async get(vendorId: string): Promise<VendorSummary> {
    const data = unwrapData(await this.client.get<unknown>(`/vendors/${encodeURIComponent(vendorId)}`));
    return toVendor(asRecord(data, 'vendor'));
  }
}

function toCategory(record: Record<string, unknown>): Category {
  return {
    id: stringField(record, 'id', 'categoryId'),
    name: stringField(record, 'name') || 'Category',
    description: stringField(record, 'description') || undefined,
    displayOrder: typeof record.displayOrder === 'number' ? record.displayOrder : undefined,
    active: typeof record.active === 'boolean' ? record.active : undefined,
  };
}

function toService(record: Record<string, unknown>): CatalogService {
  return {
    id: stringField(record, 'id', 'serviceId'),
    categoryId: stringField(record, 'categoryId') || undefined,
    name: stringField(record, 'name') || 'Service',
    description: stringField(record, 'description') || undefined,
    durationMinutes: typeof record.durationMinutes === 'number' ? record.durationMinutes : undefined,
    vehicleTypes: Array.isArray(record.vehicleTypes) ? record.vehicleTypes.filter((item): item is string => typeof item === 'string') : undefined,
    basePrice: typeof record.basePrice === 'number' ? record.basePrice : undefined,
    active: typeof record.active === 'boolean' ? record.active : undefined,
  };
}

function toSlot(record: Record<string, unknown>): Slot {
  return {
    id: stringField(record, 'id', 'slotId'),
    vendorId: stringField(record, 'vendorId') || undefined,
    date: stringField(record, 'date') || undefined,
    startTime: stringField(record, 'startTime') || 'Slot',
    endTime: stringField(record, 'endTime') || undefined,
    available: typeof record.available === 'number' ? record.available : undefined,
    status: stringField(record, 'status') || undefined,
  };
}

function toPrice(record: Record<string, unknown>): PriceBreakdown {
  if (typeof record.total !== 'number' || !Number.isFinite(record.total)) {
    throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Pricing response did not include a total');
  }
  if (record.total < 0) {
    throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Pricing response total cannot be negative');
  }
  return {
    subtotal: typeof record.subtotal === 'number' ? record.subtotal : undefined,
    discount: typeof record.discount === 'number' ? record.discount : undefined,
    tax: typeof record.tax === 'number' ? record.tax : undefined,
    convenienceFee: typeof record.convenienceFee === 'number' ? record.convenienceFee : undefined,
    total: record.total,
    currency: stringField(record, 'currency') || undefined,
    appliedCoupons: Array.isArray(record.appliedCoupons)
      ? record.appliedCoupons.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function toBooking(record: Record<string, unknown>): Booking {
  const payment = stringField(record, 'paymentStatus');
  return {
    id: stringField(record, 'id', 'bookingId'),
    customerId: stringField(record, 'customerId') || undefined,
    vendorId: stringField(record, 'vendorId') || undefined,
    vehicleId: stringField(record, 'vehicleId') || undefined,
    serviceIds: Array.isArray(record.serviceIds) ? record.serviceIds.filter((item): item is string => typeof item === 'string') : undefined,
    bookingDate: stringField(record, 'bookingDate') || undefined,
    slotId: stringField(record, 'slotId') || undefined,
    totalAmount: typeof record.totalAmount === 'number' ? record.totalAmount : undefined,
    paymentStatus: payment === 'PENDING' || payment === 'PAID' || payment === 'REFUNDED' ? payment : undefined,
    bookingStatus: stringField(record, 'bookingStatus') || undefined,
  };
}

function toVehicle(record: Record<string, unknown>): Vehicle {
  return {
    id: stringField(record, 'id', 'vehicleId'),
    userId: stringField(record, 'userId') || undefined,
    registrationNumber: stringField(record, 'registrationNumber') || 'Vehicle',
    vehicleType: stringField(record, 'vehicleType') || 'UNKNOWN',
    brand: stringField(record, 'brand') || undefined,
    model: stringField(record, 'model') || undefined,
  };
}

function toVendor(record: Record<string, unknown>): VendorSummary {
  return {
    vendorId: stringField(record, 'vendorId', 'id'),
    businessName: stringField(record, 'businessName') || undefined,
    status: stringField(record, 'status') || undefined,
    operationalStatus: stringField(record, 'operationalStatus') || undefined,
  };
}
