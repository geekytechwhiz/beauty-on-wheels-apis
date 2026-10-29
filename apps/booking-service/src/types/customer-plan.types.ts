import { CustomerPaymentStatus, PaymentProvider } from './payment.types';

/**
 * Plan lifecycle (Booking wire convention: SCREAMING_SNAKE).
 * PENDING_PAYMENT → AWAITING_FIRST_JOB (after pay + first job linked) → ACTIVE
 * once the first job actually starts (billing period anchors then).
 */
export type CustomerPlanStatus = 'PENDING_PAYMENT' | 'AWAITING_FIRST_JOB' | 'ACTIVE';
export type CustomerPlanPaymentStatus = 'PENDING' | 'PAID';
/** Derived display cadence from catalog billingPeriod for UI compatibility. */
export type PlanCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY' | 'ONE_TIME';
export type VisitDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export type PlanBillingPeriod = 'oneTime' | 'weekly' | 'monthly' | 'yearly';

export interface PlanEntitlement {
  serviceId: string;
  quantity: number;
}

/** Snapshot of the selected catalog visit-window preference. */
export interface PlanVisitWindow {
  visitWindowId: string;
  label: string;
  allDay?: boolean;
  preferredDays?: VisitDay[];
  startTime?: string;
  endTime?: string;
  timezone?: string;
}

export interface PlanLocation {
  fulfilmentType: 'community' | 'address';
  communityId?: string;
  addressId?: string;
}

export interface PlanIncludedService {
  name: string;
  description?: string;
  categoryId: string;
  tags?: string[];
  /** Stable catalog entitlement id when provided by the offering. */
  serviceKey?: string;
  visitsPerPeriod: number;
  /** Duration of one visit of this included service. */
  durationMinutes: number;
}

export interface PlanPricingSnapshot {
  /** Catalog integer amount (INR rupees). Same convention as booking snapshots. */
  totalAmount: number;
  totalMinor: number;
  currency: string;
  packageId: string;
  offeringId: string;
  packageName?: string;
  packageVersion?: number;
  vehicleType: string;
  /** Package-total duration for the selected vehicle in the billing period. */
  durationMinutes?: number;
}

export interface CustomerPlanRecord {
  planId: string;
  customerId: string;
  vendorId: string;
  /** Optional legacy field. Package plans are community-based and do not require a branch. */
  branchId?: string;
  /** Catalog offering id (PACKAGE). Kept as packageId for UI compatibility. */
  packageId: string;
  offeringId: string;
  packageName?: string;
  vehicleId: string;
  vehicleType: string;
  status: CustomerPlanStatus;
  paymentStatus: CustomerPlanPaymentStatus;
  /** Catalog billing period (camelCase), authoritative for renewal length. */
  billingPeriod: PlanBillingPeriod;
  /** Derived SCREAMING_SNAKE cadence for existing UI clients. */
  cadence: PlanCadence;
  remainingVisits: number;
  entitlements: PlanEntitlement[];
  includedServices: PlanIncludedService[];
  visitWindowId: string;
  visitWindow: PlanVisitWindow;
  location: PlanLocation;
  pricingSnapshot: PlanPricingSnapshot;
  /** Customer-selected renewal preference; applied only when true. */
  autoRenew: boolean;
  firstJobId?: string;
  /** Set when the first job transitions to IN_PROGRESS. */
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  /** Catalog validity window in days; snapshotted at purchase. */
  validityDays?: number;
  /** ISO end of package validity (set when paid/activated). */
  validUntil?: string;
  /**
   * Multi-visit schedule orchestration state.
   * NONE until vendor confirms dates; PARTIAL when some visits reserved; COMPLETE when none remain UNSCHEDULED.
   */
  scheduleState?: 'NONE' | 'IN_PROGRESS' | 'PARTIAL' | 'COMPLETE';
  /** Denormalized visit progress; authoritative source remains PackageVisit rows. */
  visitProgress?: {
    totalVisits: number;
    remainingVisits: number;
    completedVisits: number;
    cancelledVisits: number;
    missedVisits: number;
    scheduledVisits: number;
    unscheduledVisits: number;
    inProgressVisits: number;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Payment completion time (plan still awaiting first job until job starts). */
  activatedAt?: string;
}

/** Public shape returned by the customer-plan routes. */
export type CustomerPlanResponse = Omit<CustomerPlanRecord, 'customerId' | 'version'>;

export interface CustomerPlanDdbItem extends CustomerPlanRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'CustomerPlan';
}

export interface CustomerPlanIdempotencyItem {
  PK: string;
  SK: string;
  planId: string;
  customerId: string;
  requestHash: string;
  entityType: 'CustomerPlanIdempotency';
}

export interface PlanPaymentRecord {
  paymentId: string;
  planId: string;
  customerId: string;
  /** Catalog integer amount; always copied from the plan pricing snapshot. */
  amountMinor: number;
  providerAmountMinor: number;
  currency: string;
  status: CustomerPaymentStatus;
  provider: PaymentProvider;
  checkoutToken: string;
  checkoutKeyId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  idempotencyKey: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PlanPaymentDdbItem extends PlanPaymentRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'CustomerPlanPayment';
}

export interface PlanPaymentIdempotencyItem {
  PK: string;
  SK: string;
  paymentId: string;
  planId: string;
  customerId: string;
  entityType: 'CustomerPlanPaymentIdempotency';
}
