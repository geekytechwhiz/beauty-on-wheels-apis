/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface VehicleDetails {
  bodyCategory?: string;
  makeModel?: string;
  saveToGarage?: boolean;
}

export interface Booking {
  id?: string;
  customerId?: string;
  vendorId?: string;
  vehicleId?: string;
  vehicleDetails?: VehicleDetails;
  serviceIds?: string[];
  bookingDate?: string;
  slotId?: string;
  totalAmount?: number;
  paymentMethod?: string;
  paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus?: 'CREATED' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

