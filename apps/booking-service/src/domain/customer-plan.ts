import { createHash } from 'crypto';

import { BookingError } from '../errors';
import { CatalogPackage } from '../integrations/catalog.client';
import { CreateCustomerPlanCommand } from '../schemas/customer-plans.schema';
import {
  CustomerPlanRecord,
  CustomerPlanResponse,
  PlanEntitlement,
  PlanPricingSnapshot,
} from '../types/customer-plan.types';
import { moneyToMinor } from './create-booking';

/**
 * PROVISIONAL POLICY (customer plans).
 *
 * The service catalog package model has no cadence, visit-count, or
 * cancellation/refund fields. Until product defines them:
 *  - entitlements are derived from the package's SERVICE items: one visit per
 *    item occurrence (quantity 1 each) unless a catalog item ever carries an
 *    explicit positive integer `quantity`; ADDON items ride along with their
 *    service and are not separate entitlements;
 *  - `remainingVisits` is the sum of entitlement quantities;
 *  - cadence is accepted from the client request (WEEKLY | BIWEEKLY | MONTHLY)
 *    and stored as given.
 * No cancellation, pause, rollover, or refund behaviour is defined here.
 */
export function deriveEntitlements(items: CatalogPackage['items']): PlanEntitlement[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (item.itemType !== 'SERVICE') continue;
    quantities.set(item.refId, (quantities.get(item.refId) ?? 0) + (item.quantity ?? 1));
  }
  return [...quantities.entries()].map(([serviceId, quantity]) => ({ serviceId, quantity }));
}

export function totalVisits(entitlements: PlanEntitlement[]): number {
  return entitlements.reduce((sum, entry) => sum + entry.quantity, 0);
}

export function assertPackageSellable(pkg: CatalogPackage, command: Pick<CreateCustomerPlanCommand, 'vendorId' | 'packageId'>): void {
  if (pkg.id !== command.packageId || pkg.vendorId !== command.vendorId) {
    throw new BookingError('PACKAGE_NOT_FOUND', 'Package not found for the vendor', 404, 'packageId', false);
  }
  if (!pkg.active) {
    throw new BookingError('PACKAGE_INACTIVE', 'Package is not active', 409, 'packageId', false);
  }
  if (totalVisits(deriveEntitlements(pkg.items)) < 1) {
    throw new BookingError('PACKAGE_NOT_PURCHASABLE', 'Package has no service entitlements', 409, 'packageId', false);
  }
}

export function buildPlanPricingSnapshot(pkg: CatalogPackage): PlanPricingSnapshot {
  const totalMinor = moneyToMinor(pkg.discountedPrice);
  return {
    totalAmount: totalMinor,
    totalMinor,
    currency: pkg.currency.toUpperCase(),
    packageId: pkg.id,
    packageName: pkg.name,
    ...(pkg.version !== undefined ? { packageVersion: pkg.version } : {}),
  };
}

export function assertPlanExpectedPrice(
  expected: { totalMinor: number; currency: string },
  pricing: Pick<PlanPricingSnapshot, 'totalMinor' | 'currency'>,
): void {
  if (expected.currency.toUpperCase() !== pricing.currency.toUpperCase()) {
    throw new BookingError('PRICE_MISMATCH', 'Expected currency does not match the authoritative price', 409, 'expectedPrice.currency');
  }
  if (expected.totalMinor !== pricing.totalMinor) {
    throw new BookingError('PRICE_MISMATCH', 'Expected price does not match the authoritative price', 409, 'expectedPrice.totalMinor');
  }
}

export function planRequestFingerprint(command: CreateCustomerPlanCommand): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex');
}

export function toPlanResponse(record: CustomerPlanRecord): CustomerPlanResponse {
  // Owner identity and the optimistic-lock counter stay server-side.
  const { customerId: _customerId, version: _version, ...response } = record;
  return response;
}
