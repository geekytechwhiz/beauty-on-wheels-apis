import { createHash } from 'crypto';

import { BookingError } from '../errors';
import { CatalogPackage, CatalogPackageVisitWindow } from '../integrations/catalog.client';
import { CreateCustomerPlanCommand } from '../schemas/customer-plans.schema';
import {
  CustomerPlanRecord,
  CustomerPlanResponse,
  PlanBillingPeriod,
  PlanCadence,
  PlanEntitlement,
  PlanIncludedService,
  PlanPricingSnapshot,
  PlanVisitWindow,
} from '../types/customer-plan.types';
import { moneyToMinor } from './create-booking';

/**
 * Entitlements are derived from the package's included services:
 * one entitlement per service name with quantity = visitsPerPeriod.
 * remainingVisits is the sum of entitlement quantities.
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

export function mapIncludedServices(pkg: CatalogPackage): PlanIncludedService[] {
  return pkg.includedServices.map((entry) => ({
    name: entry.name,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    categoryId: entry.categoryId,
    ...(entry.tags === undefined ? {} : { tags: [...entry.tags] }),
    visitsPerPeriod: entry.visitsPerPeriod,
    durationMinutes: entry.durationMinutes,
  }));
}

export function billingPeriodToCadence(billingPeriod: PlanBillingPeriod): PlanCadence {
  switch (billingPeriod) {
    case 'weekly':
      return 'WEEKLY';
    case 'monthly':
      return 'MONTHLY';
    case 'yearly':
      return 'YEARLY';
    case 'oneTime':
      return 'ONE_TIME';
    default:
      return 'MONTHLY';
  }
}

export function resolveVehiclePrice(
  pkg: CatalogPackage,
  vehicleType: string,
): CatalogPackage['vehiclePricing'][number] {
  const matches = pkg.vehiclePricing.filter((entry) => entry.vehicleType === vehicleType);
  if (matches.length === 0) {
    throw new BookingError(
      'VEHICLE_TYPE_UNSUPPORTED',
      `Vehicle type ${vehicleType} is not supported on this package`,
      409,
      'vehicleId',
      false,
    );
  }
  if (matches.length > 1) {
    throw new BookingError(
      'VEHICLE_PRICE_AMBIGUOUS',
      `Vehicle type ${vehicleType} matches more than one offering price`,
      409,
      'vehicleId',
      false,
    );
  }
  return matches[0];
}

export function resolveVisitWindow(
  pkg: CatalogPackage,
  visitWindowId: string,
): PlanVisitWindow {
  if (pkg.visitWindows.length === 0) {
    throw new BookingError(
      'VISIT_WINDOW_UNAVAILABLE',
      'Package does not define visit-window preferences',
      409,
      'visitWindowId',
      false,
    );
  }
  const match = pkg.visitWindows.find((entry) => entry.visitWindowId === visitWindowId);
  if (!match) {
    throw new BookingError(
      'VISIT_WINDOW_INVALID',
      'visitWindowId is not offered on this package',
      400,
      'visitWindowId',
      false,
    );
  }
  return toPlanVisitWindow(match);
}

export function toPlanVisitWindow(window: CatalogPackageVisitWindow): PlanVisitWindow {
  return {
    visitWindowId: window.visitWindowId,
    label: window.label,
    ...(window.allDay === true ? { allDay: true } : {}),
    ...(window.startTime === undefined ? {} : { startTime: window.startTime }),
    ...(window.endTime === undefined ? {} : { endTime: window.endTime }),
  };
}

export function assertPackageSellable(
  pkg: CatalogPackage,
  command: Pick<CreateCustomerPlanCommand, 'vendorId' | 'packageId' | 'offeringId'>,
): void {
  const offeringId = command.offeringId || command.packageId;
  if (pkg.id !== offeringId || pkg.vendorId !== command.vendorId) {
    throw new BookingError('PACKAGE_NOT_FOUND', 'Package not found for the vendor', 404, 'offeringId', false);
  }
  if (!pkg.active) {
    throw new BookingError('PACKAGE_INACTIVE', 'Package is not active', 409, 'offeringId', false);
  }
  if (totalVisits(deriveEntitlements(pkg.items)) < 1) {
    throw new BookingError('PACKAGE_NOT_PURCHASABLE', 'Package has no service entitlements', 409, 'offeringId', false);
  }
}

export function buildPlanPricingSnapshot(
  pkg: CatalogPackage,
  vehicleType: string,
): PlanPricingSnapshot {
  const vehiclePrice = resolveVehiclePrice(pkg, vehicleType);
  const totalMinor = moneyToMinor(vehiclePrice.price);
  return {
    totalAmount: totalMinor,
    totalMinor,
    currency: pkg.currency.toUpperCase(),
    packageId: pkg.id,
    offeringId: pkg.id,
    packageName: pkg.name,
    ...(pkg.version !== undefined ? { packageVersion: pkg.version } : {}),
    vehicleType,
    durationMinutes: vehiclePrice.durationMinutes,
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

/** Billing period end exclusive of renewals; anchored to first-job start. */
export function billingPeriodEndIso(startIso: string, billingPeriod: PlanBillingPeriod): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    throw new BookingError('INVALID_BILLING_PERIOD', 'First job start time is invalid', 500);
  }
  const end = new Date(start.getTime());
  switch (billingPeriod) {
    case 'weekly':
      end.setUTCDate(end.getUTCDate() + 7);
      break;
    case 'monthly':
      end.setUTCMonth(end.getUTCMonth() + 1);
      break;
    case 'yearly':
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      break;
    case 'oneTime':
      break;
    default:
      end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return end.toISOString();
}

export function planRequestFingerprint(command: CreateCustomerPlanCommand): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex');
}

export function toPlanResponse(record: CustomerPlanRecord): CustomerPlanResponse {
  // Owner identity and the optimistic-lock counter stay server-side.
  const { customerId: _customerId, version: _version, ...response } = record;
  return response;
}
