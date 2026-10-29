import { createHash } from 'crypto';

import { Booking, PricingSnapshot } from '../types/api-types';
import { BookingError } from '../errors';
import { CreateBookingCommand } from '../schemas/bookings.schema';

const REVIEW_READY = new Set(['COMPLETED', 'PENDING_REVIEW']);

/**
 * Catalog service addressed by booking `offeringId`.
 * `version` here, when present, is the catalog input version. Booking compares
 * the submitted offeringVersion with the pricing result, not this field.
 */
export interface VehiclePricing {
  vehicleType: string;
  price: number;
  durationMinutes: number;
}

export interface CatalogOffering {
  id: string;
  active: boolean;
  vehicleTypes: string[];
  vehiclePricing: VehiclePricing[];
  version?: number;
  currency?: string;
  name?: string;
  categoryId?: string;
  vendorId?: string;
  durationMinutes?: number; // Legacy compatibility only
  /** Authoritative offering-community rows from the catalog service read. */
  communities?: Array<{ communityId: string; status: string; approvalStatus?: string }>;
}

export interface CatalogPrice {
  currency: string;
  subtotal: number;
  discount: number;
  addOnTotal: number;
  total: number;
  taxAmount?: number;
  unitPrice?: number;
  items?: Array<{
    id: string;
    name: string;
    type: 'SERVICE' | 'PACKAGE' | 'ADD_ON';
    unitPrice: number;
    total: number;
  }>;
  /** Effective offering revision. `version` is accepted as the same integer. */
  offeringVersion?: number;
  catalogVersion?: number;
  /** Applicable vendor overlay version. Zero means the vendor has no overlay. */
  vendorPricingVersion?: number;
  version?: number;
}

export interface VehicleSnapshot {
  id: string;
  userId?: string;
  vehicleType: string;
  brand?: string;
  model?: string;
  registrationNumber?: string;
}

export interface VendorSnapshot {
  vendorId: string;
  status: string;
  operationalStatus: string;
  onboardingStatus?: string;
  communityIds: string[];
  vendorName?: string;
}

export interface BranchSnapshot {
  branchId: string;
  vendorId: string;
  branchName?: string;
}

export interface CustomerProfile {
  communityIds: string[];
}

export interface ReservationSnapshot {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  durationMinutes: number;
}

export interface HeldReservation extends ReservationSnapshot {
  holdId: string;
  vendorId: string;
  branchId: string;
  customerId: string;
}

export function assertHoldMatchesCommand(
  held: HeldReservation,
  command: Pick<CreateBookingCommand, 'vendorId' | 'branchId' | 'schedule'>,
  customerId: string,
): void {
  if (held.customerId !== customerId) {
    throw new BookingError('HOLD_NOT_OWNED', 'Hold does not belong to the authenticated customer', 403, 'holdId');
  }
  if (held.vendorId !== command.vendorId || held.branchId !== command.branchId) {
    throw new BookingError('HOLD_MISMATCH', 'Hold does not match the selected vendor or branch', 409, 'holdId');
  }
  if (
    held.date !== command.schedule.date
    || held.startTime !== command.schedule.startTime
    || held.timezone !== command.schedule.timezone
  ) {
    throw new BookingError('HOLD_MISMATCH', 'Hold does not match the selected schedule', 409, 'schedule.startTime');
  }
}

export function requestFingerprint(command: CreateBookingCommand): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex');
}

export function payableAmount(booking: Pick<Booking, 'pricingSnapshot' | 'totalAmount'>): number {
  if (booking.pricingSnapshot) {
    return booking.pricingSnapshot.totalAmount;
  }
  if (typeof booking.totalAmount === 'number' && Number.isFinite(booking.totalAmount)) {
    return booking.totalAmount;
  }
  throw new BookingError(
    'CATALOG_PRICING_UNAVAILABLE',
    'Booking has no authoritative payable amount',
    502,
  );
}

export function assertVehicleOwnership(
  vehicle: VehicleSnapshot,
  customerId: string,
  vehicleId: string,
): void {
  if (vehicle.id && vehicle.id !== vehicleId) {
    throw new BookingError('VEHICLE_NOT_OWNED', 'Vehicle is not owned by the authenticated customer', 403, 'vehicleId');
  }
  if (vehicle.userId && vehicle.userId !== customerId) {
    throw new BookingError('VEHICLE_NOT_OWNED', 'Vehicle is not owned by the authenticated customer', 403, 'vehicleId');
  }
}

export function assertOffering(
  offering: CatalogOffering,
  command: Pick<CreateBookingCommand, 'offeringId'>,
  vehicleType: string,
): void {
  if (offering.id !== command.offeringId) {
    throw new BookingError('OFFERING_NOT_FOUND', 'Offering not found', 404, 'offeringId');
  }
  if (!offering.active) {
    throw new BookingError('OFFERING_INACTIVE', 'Offering is not active', 409, 'offeringId');
  }
  if (!includesIgnoreCase(offering.vehicleTypes, vehicleType)) {
    throw new BookingError(
      'VEHICLE_TYPE_NOT_SUPPORTED',
      'Vehicle type is not supported by the offering',
      409,
      'vehicleId',
    );
  }
}

export function assertVendorEligible(vendor: VendorSnapshot, vendorId: string): void {
  if (vendor.vendorId !== vendorId) {
    throw new BookingError('VENDOR_MISMATCH', 'Vendor does not match the booking', 409, 'vendorId');
  }
  const eligible =
    vendor.status === 'ACTIVE' &&
    vendor.operationalStatus === 'ONLINE' &&
    (!vendor.onboardingStatus || REVIEW_READY.has(vendor.onboardingStatus));
  if (!eligible) {
    throw new BookingError('VENDOR_NOT_ELIGIBLE', 'Vendor is not eligible for bookings', 409, 'vendorId');
  }
}

 

export function communityOfferingEnforcementEnabled(): boolean {
  return process.env.COMMUNITY_OFFERING_ENFORCEMENT === 'true';
}

/**
 * Community bookings require an approved and operationally active mapping.
 * Customer membership stays in assertLocation. Doorstep and address
 * fulfilment skip this check. Automatic approval only affects how a new
 * mapping was stored; it does not skip this check.
 * Pricing and availability stay on their existing reads.
 */
export function assertOfferingCommunity(input: {
  enforced: boolean;
  fulfilmentType: string;
  communityId?: string;
  communities?: ReadonlyArray<{ communityId: string; status: string; approvalStatus?: string }>;
}): void {
  if (!input.enforced || input.fulfilmentType !== 'community') {
    return;
  }
  const communityId = input.communityId?.trim();
  const mapping = input.communities?.find((item) => item.communityId === communityId);
  if (!communityId || !mapping || mapping.status !== 'active') {
    throw new BookingError(
      'OFFERING_COMMUNITY_INACTIVE',
      'This service is not offered in the selected community',
      409,
      'location.communityId',
    );
  }
  if (mapping.approvalStatus !== 'approved') {
    throw new BookingError(
      'OFFERING_COMMUNITY_NOT_APPROVED',
      'This service is not approved for the selected community',
      409,
      'location.communityId',
    );
  }
}

export function assertLocation(
  command: Pick<CreateBookingCommand, 'location'>,
  _vendor: VendorSnapshot,
  profile: CustomerProfile,
): void {
  const location = command.location;
  if (location.fulfilmentType === 'community') {
    if (!profile.communityIds.includes(location.communityId!)) {
      throw new BookingError(
        'COMMUNITY_NOT_ASSIGNED',
        'Customer is not a member of the selected community',
        409,
        'location.communityId',
      );
    }
  }
}

export function authoritativeOfferingVersion(price: CatalogPrice): {
  offeringVersion: number;
  catalogVersion: number;
  vendorPricingVersion: number;
} {
  const offeringVersion = price.offeringVersion ?? price.version;
  if (!isPositiveInteger(offeringVersion)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog did not return an authoritative offering version',
      502,
      'offeringVersion',
    );
  }
  if (!isPositiveInteger(price.catalogVersion)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog did not return an authoritative catalog version',
      502,
      'catalogVersion',
    );
  }
  if (!isNonNegativeInteger(price.vendorPricingVersion)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog did not return an authoritative vendor pricing version',
      502,
      'vendorPricingVersion',
    );
  }
  return {
    offeringVersion,
    catalogVersion: price.catalogVersion,
    vendorPricingVersion: price.vendorPricingVersion,
  };
}

export function buildPricingSnapshot(input: {
  offeringId: string;
  offeringVersion: number;
  catalogVersion: number;
  vendorPricingVersion: number;
  price: CatalogPrice;
}): PricingSnapshot {
  const currency = requireCurrency(input.price.currency);
  const subtotal = requireMoney(input.price.subtotal, 'subtotal');
  const discount = requireMoney(input.price.discount, 'discount');
  const addOnTotal = requireMoney(input.price.addOnTotal, 'addOnTotal');
  const total = requireMoney(input.price.total, 'total');
  const unitPrice = input.price.unitPrice === undefined
    ? subtotal
    : requireMoney(input.price.unitPrice, 'unitPrice');
  const derivedTax = roundMoney(total - subtotal - addOnTotal + discount);
  const taxAmount = input.price.taxAmount === undefined
    ? derivedTax
    : requireMoney(input.price.taxAmount, 'taxAmount');
  if (taxAmount < 0) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned a price that does not reconcile',
      502,
    );
  }
  const reconciled = roundMoney(subtotal + addOnTotal - discount + taxAmount);
  if (Math.abs(reconciled - total) > 0.01) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog returned a price that does not reconcile',
      502,
    );
  }
  return {
    offeringId: input.offeringId,
    offeringVersion: input.offeringVersion,
    catalogVersion: input.catalogVersion,
    vendorPricingVersion: input.vendorPricingVersion,
    baseAmount: unitPrice,
    addOnAmount: addOnTotal,
    subtotalAmount: subtotal,
    discountAmount: discount,
    taxAmount,
    totalAmount: total,
    baseMinor: moneyToMinor(unitPrice),
    addOnMinor: moneyToMinor(addOnTotal),
    subtotalMinor: moneyToMinor(subtotal),
    discountMinor: moneyToMinor(discount),
    taxMinor: moneyToMinor(taxAmount),
    totalMinor: moneyToMinor(total),
    currency,
  };
}

export function assertExpectedPrice(
  expected: { totalMinor: number; currency: string },
  pricing: PricingSnapshot,
): void {
  console.log('assertExpectedPrice', expected, pricing);
  if (expected.currency.toUpperCase() !== pricing.currency.toUpperCase()) {
    throw new BookingError('PRICE_MISMATCH', 'Expected currency does not match the authoritative price', 409, 'expectedPrice.currency');
  }
  if (expected.totalMinor !== pricing.totalMinor) {
    throw new BookingError('PRICE_MISMATCH', 'Expected price does not match the authoritative price', 409, 'expectedPrice.totalMinor');
  }
}

/** Converts a civil time in an IANA zone without trusting a client UTC value. */
export function civilTimeToUtc(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const requested = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(requested);
  // Two passes also cover DST offset changes around the requested local time.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const rendered = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
    instant = new Date(instant.getTime() + requested - rendered);
  }
  return instant.toISOString();
}

/**
 * Catalog prices are already the integer amount the client submits as totalMinor.
 * Scaling by 100 turns 699 into 69900 and fails the price check.
 */
export function moneyToMinor(amount: number): number {
  return Math.round(amount);
}

function requireCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog did not return a currency',
      502,
      'currency',
    );
  }
  return value.toUpperCase();
}

function requireMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      `Service Catalog did not return ${field}`,
      502,
      field,
    );
  }
  return roundMoney(value);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function includesIgnoreCase(values: readonly string[], expected: string): boolean {
  const target = expected.trim().toLowerCase();
  return values.some((value) => value.trim().toLowerCase() === target);
}
