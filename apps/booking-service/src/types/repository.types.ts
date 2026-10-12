
export interface VehicleDetailsDdb {
  bodyCategory?: string;
  makeModel?: string;
  saveToGarage?: boolean;
}

export interface PricingSnapshotDdb {
  offeringId: string;
  offeringVersion: number;
  catalogVersion?: number;
  vendorPricingVersion?: number;
  baseAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
}

export interface BookingLocationDdb {
  fulfilmentType: 'community' | 'address';
  communityId?: string;
  addressId?: string;
}

export interface BookingDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  customerId: string;
  vendorId: string;
  branchId?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetailsDdb;
  serviceIds: string[];
  offeringId?: string;
  offeringVersion?: number;
  bookingDate: string;
  slotId: string;
  holdId?: string;
  location?: BookingLocationDdb;
  pricingSnapshot?: PricingSnapshotDdb;
  quoteId?: string;
  totalAmount: number;
  paymentMethod?: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus: 'CREATED' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
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
  customerId: string;
  vendorId: string;
  branchId?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetailsDdb;
  serviceIds: string[];
  offeringId?: string;
  offeringVersion?: number;
  bookingDate: string;
  slotId: string;
  holdId?: string;
  location?: BookingLocationDdb;
  pricingSnapshot?: PricingSnapshotDdb;
  quoteId?: string;
  totalAmount: number;
  paymentMethod?: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus: 'CREATED' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  entityType: 'CustomerBooking' | 'VendorBooking';
}

export interface BookingIdempotencyItem {
  PK: string;
  SK: string;
  bookingId: string;
  customerId: string;
  holdId: string;
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

