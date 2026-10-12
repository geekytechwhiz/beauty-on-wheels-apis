import { Booking } from '../types/api-types';
import { BookingDdbItem, BookingLookupDdbItem } from '../types/repository.types';

function snapshotFields(booking: Booking) {
  return {
    ...(booking.branchId ? { branchId: booking.branchId } : {}),
    ...(booking.offeringId ? { offeringId: booking.offeringId } : {}),
    ...(booking.offeringVersion !== undefined ? { offeringVersion: booking.offeringVersion } : {}),
    ...(booking.holdId ? { holdId: booking.holdId } : {}),
    ...(booking.location ? { location: booking.location } : {}),
    ...(booking.pricingSnapshot ? { pricingSnapshot: booking.pricingSnapshot } : {}),
    ...(booking.quoteId ? { quoteId: booking.quoteId } : {}),
  };
}

export class BookingsMapper {
  static toDomain(item: BookingDdbItem | BookingLookupDdbItem): Booking {
    return {
      id: item.id,
      customerId: item.customerId,
      vendorId: item.vendorId,
      branchId: item.branchId,
      vehicleId: item.vehicleId,
      vehicleDetails: item.vehicleDetails,
      serviceIds: item.serviceIds,
      offeringId: item.offeringId,
      offeringVersion: item.offeringVersion,
      bookingDate: item.bookingDate,
      slotId: item.slotId,
      holdId: item.holdId,
      location: item.location,
      pricingSnapshot: item.pricingSnapshot,
      quoteId: item.quoteId,
      totalAmount: item.totalAmount,
      paymentMethod: item.paymentMethod,
      paymentStatus: item.paymentStatus,
      bookingStatus: item.bookingStatus,
    };
  }

  static toDdbItem(booking: Booking, version = 1, createdAt?: string): BookingDdbItem {
    const timestamp = new Date().toISOString();
    const id = booking.id!;
    return {
      PK: `BOOKING#${id}`,
      SK: `BOOKING#${id}`,
      GSI1PK: 'BOOKING_LIST',
      GSI1SK: `BOOKING#${booking.bookingDate}#${id}`,
      id,
      customerId: booking.customerId!,
      vendorId: booking.vendorId!,
      vehicleId: booking.vehicleId,
      vehicleDetails: booking.vehicleDetails,
      serviceIds: booking.serviceIds || [],
      ...snapshotFields(booking),
      bookingDate: booking.bookingDate!,
      slotId: booking.slotId!,
      totalAmount: booking.pricingSnapshot?.totalAmount ?? booking.totalAmount ?? 0,
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus || 'PENDING',
      bookingStatus: booking.bookingStatus || 'CREATED',
      version,
      createdAt: createdAt || timestamp,
      updatedAt: timestamp,
      entityType: 'Booking',
    };
  }

  static toCustomerLookupDdb(booking: Booking, createdAt?: string): BookingLookupDdbItem {
    const timestamp = new Date().toISOString();
    const id = booking.id!;
    const customerId = booking.customerId!;
    return {
      PK: `CUSTOMER#${customerId}`,
      SK: `BOOKING#${id}`,
      GSI1PK: `CUSTOMER#${customerId}`,
      GSI1SK: `BOOKING#${booking.bookingDate}#${id}`,
      id,
      customerId,
      vendorId: booking.vendorId!,
      vehicleId: booking.vehicleId,
      vehicleDetails: booking.vehicleDetails,
      serviceIds: booking.serviceIds || [],
      ...snapshotFields(booking),
      bookingDate: booking.bookingDate!,
      slotId: booking.slotId!,
      totalAmount: booking.pricingSnapshot?.totalAmount ?? booking.totalAmount ?? 0,
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus || 'PENDING',
      bookingStatus: booking.bookingStatus || 'CREATED',
      createdAt: createdAt || timestamp,
      updatedAt: timestamp,
      entityType: 'CustomerBooking',
    };
  }

  static toVendorLookupDdb(booking: Booking, createdAt?: string): BookingLookupDdbItem {
    const timestamp = new Date().toISOString();
    const id = booking.id!;
    const vendorId = booking.vendorId!;
    return {
      PK: `VENDOR#${vendorId}`,
      SK: `BOOKING#${id}`,
      GSI1PK: `VENDOR#${vendorId}`,
      GSI1SK: `BOOKING#${booking.bookingDate}#${id}`,
      id,
      customerId: booking.customerId!,
      vendorId,
      vehicleId: booking.vehicleId,
      vehicleDetails: booking.vehicleDetails,
      serviceIds: booking.serviceIds || [],
      ...snapshotFields(booking),
      bookingDate: booking.bookingDate!,
      slotId: booking.slotId!,
      totalAmount: booking.pricingSnapshot?.totalAmount ?? booking.totalAmount ?? 0,
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus || 'PENDING',
      bookingStatus: booking.bookingStatus || 'CREATED',
      createdAt: createdAt || timestamp,
      updatedAt: timestamp,
      entityType: 'VendorBooking',
    };
  }
}
