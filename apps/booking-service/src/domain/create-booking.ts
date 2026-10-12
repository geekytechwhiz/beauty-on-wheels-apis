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
export interface CatalogOffering {
  id: string;
  active: boolean;
  vehicleTypes: string[];
  version?: number;
  currency?: string;
}

export interface CatalogPrice {
  currency: string;
  subtotal: number;
  discount: number;
  addOnTotal: number;
  total: number;
  taxAmount?: number;
  unitPrice?: number;
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
}

export interface VendorSnapshot {
  vendorId: string;
  status: string;
  operationalStatus: string;
  onboardingStatus?: string;
  communityIds: string[];
}

export interface BranchSnapshot {
  branchId: string;
  vendorId: string;
}

export interface SlotSnapshot {
  id: string;
  vendorId: string;
  branchId: string;
  date: string;
  status: string;
  serviceIds: string[];
  vehicleTypeIds: string[];
}

export interface HoldSnapshot {
  holdId: string;
  slotId: string;
  vendorId: string;
  branchId: string;
  customerId?: string;
  status: string;
  expiresAt: string;
  bookingId?: string;
}

export interface CustomerProfile {
  communityIds: string[];
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
  command: CreateBookingCommand,
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

export function assertBranch(branch: BranchSnapshot, command: CreateBookingCommand): void {
  if (branch.branchId !== command.branchId || branch.vendorId !== command.vendorId) {
    throw new BookingError(
      'VENDOR_BRANCH_MISMATCH',
      'Branch does not belong to the selected vendor',
      409,
      'branchId',
    );
  }
}

export function assertSlot(
  slot: SlotSnapshot,
  command: CreateBookingCommand,
  vehicleType: string,
): void {
  if (slot.id !== command.slotId) {
    throw new BookingError('SLOT_UNAVAILABLE', 'Slot does not match the booking', 409, 'slotId');
  }
  if (slot.vendorId !== command.vendorId || slot.branchId !== command.branchId) {
    throw new BookingError(
      'VENDOR_BRANCH_MISMATCH',
      'Slot does not belong to the selected vendor and branch',
      409,
      'slotId',
    );
  }
  if (slot.status === 'blocked') {
    throw new BookingError('SLOT_UNAVAILABLE', 'Slot is not bookable', 409, 'slotId');
  }
  if (!slot.serviceIds.includes(command.offeringId)) {
    throw new BookingError(
      'SLOT_OFFERING_MISMATCH',
      'Slot is not compatible with the selected offering',
      409,
      'slotId',
    );
  }
  if (
    slot.vehicleTypeIds.length > 0 &&
    !includesIgnoreCase(slot.vehicleTypeIds, vehicleType)
  ) {
    throw new BookingError(
      'SLOT_VEHICLE_MISMATCH',
      'Slot is not compatible with the selected vehicle type',
      409,
      'slotId',
    );
  }
}

export function assertHold(
  hold: HoldSnapshot,
  command: CreateBookingCommand,
  customerId: string,
  now: Date,
): void {
  if (hold.holdId !== command.holdId) {
    throw new BookingError('HOLD_NOT_FOUND', 'Hold not found', 404, 'holdId');
  }
  if (hold.customerId && hold.customerId !== customerId) {
    throw new BookingError('HOLD_NOT_OWNED', 'Hold does not belong to the authenticated customer', 403, 'holdId');
  }
  if (!hold.customerId) {
    throw new BookingError('HOLD_NOT_OWNED', 'Hold ownership could not be verified', 403, 'holdId');
  }
  if (hold.vendorId !== command.vendorId || hold.branchId !== command.branchId) {
    throw new BookingError(
      'VENDOR_BRANCH_MISMATCH',
      'Hold does not belong to the selected vendor and branch',
      409,
      'holdId',
    );
  }
  if (hold.slotId !== command.slotId) {
    throw new BookingError('SLOT_UNAVAILABLE', 'Hold does not reference the selected slot', 409, 'holdId');
  }
  if (hold.status === 'consumed') {
    throw new BookingError('HOLD_ALREADY_CONSUMED', 'Hold is already consumed', 409, 'holdId');
  }
  if (hold.status === 'expired' || hold.expiresAt <= now.toISOString()) {
    throw new BookingError('HOLD_EXPIRED', 'Hold has expired', 409, 'holdId');
  }
  if (hold.status !== 'active') {
    throw new BookingError('SLOT_UNAVAILABLE', 'Hold is not active', 409, 'holdId');
  }
}

export function assertLocation(
  command: CreateBookingCommand,
  vendor: VendorSnapshot,
  profile: CustomerProfile,
): void {
  const location = command.location;
  if (location.fulfilmentType === 'community') {
    if (!vendor.communityIds.includes(location.communityId!)) {
      throw new BookingError(
        'COMMUNITY_NOT_SERVED',
        'Vendor does not serve the selected community',
        409,
        'location.communityId',
      );
    }
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
    discountAmount: discount,
    taxAmount,
    totalAmount: total,
    currency,
  };
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
