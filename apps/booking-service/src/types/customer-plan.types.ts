import { CustomerPaymentStatus, PaymentProvider } from './payment.types';

export type CustomerPlanStatus = 'PENDING_PAYMENT' | 'ACTIVE';
export type CustomerPlanPaymentStatus = 'PENDING' | 'PAID';
export type PlanCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type VisitDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface PlanEntitlement {
  serviceId: string;
  quantity: number;
}

export interface PlanVisitWindow {
  preferredDays: VisitDay[];
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface PlanLocation {
  fulfilmentType: 'community' | 'address';
  communityId?: string;
  addressId?: string;
}

export interface PlanPricingSnapshot {
  /** Catalog integer amount (INR rupees). Same convention as booking snapshots. */
  totalAmount: number;
  totalMinor: number;
  currency: string;
  packageId: string;
  packageName?: string;
  packageVersion?: number;
}

export interface CustomerPlanRecord {
  planId: string;
  customerId: string;
  vendorId: string;
  branchId: string;
  packageId: string;
  packageName?: string;
  vehicleId: string;
  status: CustomerPlanStatus;
  paymentStatus: CustomerPlanPaymentStatus;
  cadence: PlanCadence;
  remainingVisits: number;
  entitlements: PlanEntitlement[];
  visitWindow: PlanVisitWindow;
  location: PlanLocation;
  pricingSnapshot: PlanPricingSnapshot;
  version: number;
  createdAt: string;
  updatedAt: string;
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
