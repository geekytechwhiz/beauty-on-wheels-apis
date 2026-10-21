/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface VehicleDetails {
  bodyCategory?: string;
  makeModel?: string;
  type?: string;
  brand?: string;
  model?: string;
  registrationNumber?: string;
  saveToGarage?: boolean;
}

export interface BookingLocation {
  fulfilmentType: 'community' | 'address';
  communityId?: string;
  addressId?: string;
  /** Address/community fields resolved from User Service; never client supplied. */
  details?: Record<string, string>;
}

export interface PricingSnapshot {
  offeringId: string;
  offeringVersion: number;
  /** Catalog service version used for this price. Absent on bookings created before versioning. */
  catalogVersion?: number;
  /** Vendor overlay version used for this price. Zero means no overlay. */
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

export interface BookingSchedule {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  timezone: string;
  startAtUtc: string;
  endAtUtc: string;
}

export interface BookingServiceSnapshot {
  serviceId: string;
  name: string;
  categoryId?: string;
  offeringId: string;
  durationMinutes: number;
}

export interface BookingAddOnSnapshot {
  id: string;
  name: string;
  price: number;
  priceMinor: number;
}

export interface Booking {
  id?: string;
  reference?: string;
  customerId?: string;
  vendorId?: string;
  vendorName?: string;
  branchId?: string;
  branchName?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetails;
  serviceIds?: string[];
  offeringId?: string;
  offeringVersion?: number;
  service?: BookingServiceSnapshot;
  addOns?: BookingAddOnSnapshot[];
  schedule?: BookingSchedule;
  bookingDate?: string;
  slotId?: string;
  holdId?: string;
  location?: BookingLocation;
  notes?: string;
  pricingSnapshot?: PricingSnapshot;
  /** Preserved when a historical booking already stored a quote. Create no longer accepts it. */
  quoteId?: string;
  totalAmount?: number;
  paymentMethod?: string;
  paymentStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  bookingStatus?: 'CREATED' | 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  createdAt?: string;
  updatedAt?: string;
}

