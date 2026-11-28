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

/**
 * Vendor/customer/list GSI1 sort key for bookings.
 *
 * Prefer schedule.date (true service date). Package-linked first jobs (planId set,
 * no schedule) stay BOOKING#UNSCHEDULED even when bookingDate later mirrors the
 * earliest confirmed PackageVisit civil date — PackageVisit on GSI3 is the
 * operational work record. bookingDate itself is the service start date when set
 * (earliest confirmed slot), not the confirmation/activation timestamp.
 */
export function bookingWorkGsi1Sk(booking: Booking, id: string): string {
  const serviceDate = booking.schedule?.date?.trim();
  if (serviceDate) return `BOOKING#${serviceDate}#${id}`;
  if (booking.planId?.trim()) return `BOOKING#UNSCHEDULED#${id}`;
  const bookingDate = booking.bookingDate?.trim();
  if (bookingDate) return `BOOKING#${bookingDate}#${id}`;
  return `BOOKING#UNSCHEDULED#${id}`;
}

/** Community partition id when the booking is fulfilled at a community. */
export function bookingCommunityId(booking: Booking): string | undefined {
  if (booking.location?.fulfilmentType !== 'community') return undefined;
  const communityId = booking.location.communityId?.trim();
  return communityId || undefined;
}

/** Map package-visit status onto the Booking status union for list projections. */
function visitStatusToBookingStatus(
  status: unknown,
): Booking['bookingStatus'] {
  switch (status) {
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'SCHEDULED':
    case 'BLOCKED':
    case 'MISSED':
    case 'UNSCHEDULED':
      return 'CONFIRMED';
    default:
      return 'CREATED';
  }
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
      slotReserved: item.slotReserved,
      bookingStatus: item.bookingStatus,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /**
   * Project a PackageVisit GSI1 row onto Booking so vendor list endpoints can
   * surface VISIT# work without a second client call. Canonical visit APIs
   * remain GET /vendors/{vendorId}/package-visits.
   */
  static packageVisitToBookingProjection(item: Record<string, unknown>): Booking {
    const visitId = typeof item.visitId === 'string' ? item.visitId : undefined;
    const rawSchedule =
      item.schedule && typeof item.schedule === 'object'
        ? (item.schedule as Record<string, unknown>)
        : undefined;
    const scheduleDate =
      typeof rawSchedule?.date === 'string' ? rawSchedule.date : undefined;
    const bookingDate =
      scheduleDate ||
      (typeof item.scheduleStartDate === 'string' ? item.scheduleStartDate : undefined);
    const serviceId = typeof item.serviceId === 'string' ? item.serviceId : undefined;
    const serviceName =
      typeof item.serviceName === 'string' ? item.serviceName : undefined;
    const durationMinutes =
      typeof item.durationMinutes === 'number'
        ? item.durationMinutes
        : typeof rawSchedule?.durationMinutes === 'number'
          ? rawSchedule.durationMinutes
          : undefined;

    return {
      id: visitId,
      customerId: typeof item.customerId === 'string' ? item.customerId : undefined,
      vendorId: typeof item.vendorId === 'string' ? item.vendorId : undefined,
      vehicleId: typeof item.vehicleId === 'string' ? item.vehicleId : undefined,
      serviceIds: serviceId ? [serviceId] : [],
      planId: typeof item.planId === 'string' ? item.planId : undefined,
      ...(serviceId && serviceName && durationMinutes !== undefined
        ? {
            service: {
              serviceId,
              name: serviceName,
              offeringId: serviceId,
              durationMinutes,
            },
          }
        : {}),
      ...(scheduleDate &&
      typeof rawSchedule?.startTime === 'string' &&
      typeof rawSchedule?.timezone === 'string'
        ? {
            schedule: {
              date: scheduleDate,
              startTime: rawSchedule.startTime,
              endTime:
                typeof rawSchedule.endTime === 'string'
                  ? rawSchedule.endTime
                  : rawSchedule.startTime,
              durationMinutes: durationMinutes ?? 0,
              timezone: rawSchedule.timezone,
              startAtUtc: '',
              endAtUtc: '',
            },
          }
        : {}),
      bookingDate,
      slotId:
        typeof rawSchedule?.slotId === 'string' ? rawSchedule.slotId : '',
      ...(typeof item.communityId === 'string'
        ? {
            location: {
              fulfilmentType: 'community' as const,
              communityId: item.communityId,
            },
          }
        : {}),
      bookingStatus: visitStatusToBookingStatus(item.status),
      paymentStatus: 'PAID',
      totalAmount: 0,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    };
  }

  static toDdbItem(booking: Booking, version = 1, createdAt?: string): BookingDdbItem {
    const timestamp = new Date().toISOString();
    const id = booking.id!;
    return {
      PK: `BOOKING#${id}`,
      SK: `BOOKING#${id}`,
      GSI1PK: 'BOOKING_LIST',
      GSI1SK: bookingWorkGsi1Sk(booking, id),
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
      ...(booking.slotReserved === undefined ? {} : { slotReserved: booking.slotReserved }),
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
      GSI1SK: bookingWorkGsi1Sk(booking, id),
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
      ...(booking.slotReserved === undefined ? {} : { slotReserved: booking.slotReserved }),
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
      GSI1SK: bookingWorkGsi1Sk(booking, id),
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
      ...(booking.slotReserved === undefined ? {} : { slotReserved: booking.slotReserved }),
      bookingStatus: booking.bookingStatus || 'CREATED',
      createdAt: createdAt || timestamp,
      updatedAt: timestamp,
      entityType: 'VendorBooking',
    };
  }

  /**
   * Community booking lookup for GSI1 list-by-community.
   * Only call when bookingCommunityId(booking) is defined.
   */
  static toCommunityLookupDdb(booking: Booking, createdAt?: string): BookingLookupDdbItem {
    const timestamp = new Date().toISOString();
    const id = booking.id!;
    const communityId = bookingCommunityId(booking);
    if (!communityId) {
      throw new Error('toCommunityLookupDdb requires location.communityId');
    }
    return {
      PK: `COMMUNITY#${communityId}`,
      SK: `BOOKING#${id}`,
      GSI1PK: `COMMUNITY#${communityId}`,
      GSI1SK: bookingWorkGsi1Sk(booking, id),
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
      ...(booking.slotReserved === undefined ? {} : { slotReserved: booking.slotReserved }),
      bookingStatus: booking.bookingStatus || 'CREATED',
      createdAt: createdAt || timestamp,
      updatedAt: timestamp,
      entityType: 'CommunityBooking',
    };
  }
}
