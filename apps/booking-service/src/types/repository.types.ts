
export interface VehicleDetailsDdb {
  bodyCategory?: string;
  makeModel?: string;
  type?: string;
  brand?: string;
  model?: string;
  registrationNumber?: string;
  saveToGarage?: boolean;
}

export interface PricingSnapshotDdb {
  offeringId: string;
  offeringVersion: number;
  catalogVersion?: number;
  vendorPricingVersion?: number;
  baseAmount: number;
  addOnAmount?: number;
  subtotalAmount?: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  baseMinor?: number;
  addOnMinor?: number;
  subtotalMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
  totalMinor: number;
  currency: string;
}

export interface BookingLocationDdb {
  fulfilmentType: 'community' | 'address';
  communityId?: string;
  addressId?: string;
  details?: Record<string, string>;
}

export interface BookingScheduleDdb {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  timezone: string;
  startAtUtc: string;
  endAtUtc: string;
}

export interface BookingServiceSnapshotDdb {
  serviceId: string;
  name: string;
  categoryId?: string;
  offeringId: string;
  durationMinutes: number;
}

export interface BookingAddOnSnapshotDdb {
  id: string;
  name: string;
  price: number;
  priceMinor: number;
}

export interface BookingDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  reference?: string;
  customerId: string;
  vendorId: string;
  vendorName?: string;
  branchId?: string;
  branchName?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetailsDdb;
  serviceIds: string[];
  offeringId?: string;
  offeringVersion?: number;
  /** Present when this booking is the first (or subsequent) job for a package plan. */
  planId?: string;
  packageId?: string;
  service?: BookingServiceSnapshotDdb;
  addOns?: BookingAddOnSnapshotDdb[];
  schedule?: BookingScheduleDdb;
  bookingDate: string;
  slotId: string;
  holdId?: string;
  /** Availability allocation key. Absent means the booking id (original reservation). */
  allocationId?: string;
  location?: BookingLocationDdb;
  notes?: string;
  pricingSnapshot?: PricingSnapshotDdb;
  quoteId?: string;
  totalAmount: number;
  paymentMethod?: string;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  bookingStatus: 'CREATED' | 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  version: number;
  createdAt: string;
  updatedAt: string;
  entityType: 'Booking';
}

export interface BookingLookupDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  reference?: string;
  customerId: string;
  vendorId: string;
  vendorName?: string;
  branchId?: string;
  branchName?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetailsDdb;
  serviceIds: string[];
  offeringId?: string;
  offeringVersion?: number;
  planId?: string;
  packageId?: string;
  service?: BookingServiceSnapshotDdb;
  addOns?: BookingAddOnSnapshotDdb[];
  schedule?: BookingScheduleDdb;
  bookingDate: string;
  slotId: string;
  holdId?: string;
  /** Availability allocation key. Absent means the booking id (original reservation). */
  allocationId?: string;
  location?: BookingLocationDdb;
  notes?: string;
  pricingSnapshot?: PricingSnapshotDdb;
  quoteId?: string;
  totalAmount: number;
  paymentMethod?: string;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  bookingStatus: 'CREATED' | 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  entityType: 'CustomerBooking' | 'VendorBooking';
}

export interface BookingIdempotencyItem {
  PK: string;
  SK: string;
  bookingId: string;
  customerId: string;
  holdId?: string;
  requestHash: string;
  entityType: 'BookingIdempotency';
}

export interface HoldBookingItem {
  PK: string;
  SK: string;
  bookingId: string;
  customerId: string;
  holdId: string;
  entityType: 'HoldBooking';
}

export interface SlotReservationDdbItem {
  PK: string;
  SK: string;
  bookingId: string;
  createdAt: string;
  entityType: 'SlotReservation';
}

export interface AuditLogDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  bookingId: string;
  action: string;
  performedBy: string;
  timestamp: string;
  details: string;
  entityType: 'AuditLog';
}

