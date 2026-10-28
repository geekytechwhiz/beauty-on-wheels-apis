import { Booking } from '../types/api-types';
import { BookingDdbItem, BookingLookupDdbItem } from '../types/repository.types';

function snapshotFields(booking: Booking) {
  return {
    ...(booking.branchId ? { branchId: booking.branchId } : {}),
    ...(booking.reference ? { reference: booking.reference } : {}),
    ...(booking.vendorName ? { vendorName: booking.vendorName } : {}),
    ...(booking.branchName ? { branchName: booking.branchName } : {}),
    ...(booking.offeringId ? { offeringId: booking.offeringId } : {}),
    ...(booking.offeringVersion !== undefined ? { offeringVersion: booking.offeringVersion } : {}),
    ...(booking.planId ? { planId: booking.planId } : {}),
    ...(booking.packageId ? { packageId: booking.packageId } : {}),
    ...(booking.holdId ? { holdId: booking.holdId } : {}),
    ...(booking.allocationId ? { allocationId: booking.allocationId } : {}),
    ...(booking.location ? { location: booking.location } : {}),
    ...(booking.service ? { service: booking.service } : {}),
    ...(booking.addOns ? { addOns: booking.addOns } : {}),
    ...(booking.schedule ? { schedule: booking.schedule } : {}),
    ...(booking.notes ? { notes: booking.notes } : {}),
    ...(booking.pricingSnapshot ? { pricingSnapshot: booking.pricingSnapshot } : {}),
    ...(booking.quoteId ? { quoteId: booking.quoteId } : {}),
  };
}

export class BookingsMapper {
  static toDomain(item: BookingDdbItem | BookingLookupDdbItem): Booking {
    return {
      id: item.id,
      reference: item.reference,
      customerId: item.customerId,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      branchId: item.branchId,
      branchName: item.branchName,
      vehicleId: item.vehicleId,
      vehicleDetails: item.vehicleDetails,
      serviceIds: item.serviceIds,
      offeringId: item.offeringId,
      offeringVersion: item.offeringVersion,
      planId: item.planId,
      packageId: item.packageId,
      service: item.service,
      addOns: item.addOns,
      schedule: item.schedule,
      bookingDate: item.bookingDate,
      slotId: item.slotId,
      holdId: item.holdId,
      allocationId: item.allocationId,
      location: item.location,
      notes: item.notes,
      pricingSnapshot: item.pricingSnapshot,
      quoteId: item.quoteId,
      totalAmount: item.totalAmount,
      paymentMethod: item.paymentMethod,
      paymentStatus: item.paymentStatus,
      bookingStatus: item.bookingStatus,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
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
      ...(booking.reference ? { reference: booking.reference } : {}),
      customerId: booking.customerId!,
      vendorId: booking.vendorId!,
      ...(booking.vendorName ? { vendorName: booking.vendorName } : {}),
      vehicleId: booking.vehicleId,
      vehicleDetails: booking.vehicleDetails,
      serviceIds: booking.serviceIds || [],
      ...snapshotFields(booking),
      bookingDate: booking.bookingDate || booking.schedule?.date || '',
      slotId: booking.slotId || '',
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
      ...(booking.reference ? { reference: booking.reference } : {}),
      customerId,
      vendorId: booking.vendorId!,
      ...(booking.vendorName ? { vendorName: booking.vendorName } : {}),
      vehicleId: booking.vehicleId,
      vehicleDetails: booking.vehicleDetails,
      serviceIds: booking.serviceIds || [],
      ...snapshotFields(booking),
      bookingDate: booking.bookingDate || booking.schedule?.date || '',
      slotId: booking.slotId || '',
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
      ...(booking.reference ? { reference: booking.reference } : {}),
      customerId: booking.customerId!,
      vendorId,
      ...(booking.vendorName ? { vendorName: booking.vendorName } : {}),
      vehicleId: booking.vehicleId,
      vehicleDetails: booking.vehicleDetails,
      serviceIds: booking.serviceIds || [],
      ...snapshotFields(booking),
      bookingDate: booking.bookingDate || booking.schedule?.date || '',
      slotId: booking.slotId || '',
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
