
export interface BookingDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  customerId: string;
  vendorId: string;
  vehicleId?: string;
  serviceIds: string[];
  bookingDate: string;
  slotId: string;
  totalAmount: number;
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
  vehicleId?: string;
  serviceIds: string[];
  bookingDate: string;
  slotId: string;
  totalAmount: number;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  bookingStatus: 'CREATED' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  entityType: 'CustomerBooking' | 'VendorBooking';
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

