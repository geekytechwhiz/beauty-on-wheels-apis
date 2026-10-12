/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface VehicleDetails {
  bodyCategory?: string;
  makeModel?: string;
  saveToGarage?: boolean;
}

export interface BookingLocation {
  fulfilmentType: 'community' | 'address';
  communityId?: string;
  addressId?: string;
}

export interface PricingSnapshot {
  offeringId: string;
  offeringVersion: number;
  /** Catalog service version used for this price. Absent on bookings created before versioning. */
  catalogVersion?: number;
  /** Vendor overlay version used for this price. Zero means no overlay. */
  vendorPricingVersion?: number;
  baseAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
}

export interface Booking {
  id?: string;
  customerId?: string;
  vendorId?: string;
  branchId?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetails;
  serviceIds?: string[];
  offeringId?: string;
  offeringVersion?: number;
  bookingDate?: string;
  slotId?: string;
  holdId?: string;
  location?: BookingLocation;
  pricingSnapshot?: PricingSnapshot;
  /** Preserved when a historical booking already stored a quote. Create no longer accepts it. */
  quoteId?: string;
  totalAmount?: number;
  paymentMethod?: string;
  paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus?: 'CREATED' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

