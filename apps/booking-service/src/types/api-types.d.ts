/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface Booking {
  id?: string;
  customerId?: string;
  vendorId?: string;
  vehicleId?: string;
  serviceIds?: string[];
  bookingDate?: string;
  slotId?: string;
  totalAmount?: number;
  paymentStatus?: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus?: 'CREATED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

