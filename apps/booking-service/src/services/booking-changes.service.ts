import { createHash, randomUUID } from 'crypto';

import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { authorizationHeader, headerValue, requireCustomerId } from '../auth/access';
import {
  assertBranch,
  assertHoldMatchesCommand,
  assertLocation,
  assertOffering,
  assertOfferingCommunity,
  assertVehicleOwnership,
  assertVendorEligible,
  authoritativeOfferingVersion,
  buildPricingSnapshot,
  civilTimeToUtc,
  communityOfferingEnforcementEnabled,
  moneyToMinor,
  ReservationSnapshot,
  VehiclePricing,
} from '../domain/create-booking';
import { assertPlanExpectedPrice } from '../domain/customer-plan';
import { BookingError } from '../errors';
import { AvailabilityGateway, getAvailabilityGateway } from '../integrations/availability.client';
import { CatalogGateway, getCatalogGateway } from '../integrations/catalog.client';
import { UserGateway, getUserGateway } from '../integrations/user.client';
import { VehicleGateway, getVehicleGateway } from '../integrations/vehicle.client';
import { VendorGateway, getVendorGateway } from '../integrations/vendor.client';
import { BookingsMapper } from '../mappers/bookings.mapper';
import {
  BookingChangeRecord,
  BookingChangesRepository,
  getBookingChangesRepository,
} from '../repositories/booking-changes.repository';
import { BookingsRepository, getBookingsRepository } from '../repositories/bookings.repository';
import { PaymentsRepository, getPaymentsRepository } from '../repositories/payments.repository';
import { BookingChangeCommand, validateBookingChange } from '../schemas/booking-changes.schema';
import { Booking, PricingSnapshot } from '../types/api-types';
import { BookingDdbItem } from '../types/repository.types';

const baseLogger = createLogger({ service: 'booking-changes-service', redactPII: true });

const CHANGEABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'];

export type PaymentImpact = 'CHARGE' | 'REFUND' | 'NONE';

export interface BookingChangeSnapshot {
  vendorId: string;
  vendorName?: string;
  branchId?: string;
  branchName?: string;
  offeringId?: string;
  serviceName?: string;
  schedule?: { date: string; startTime: string; endTime?: string; timezone: string };
  addOns?: Array<{ id: string; name: string; price: number }>;
  pricingSnapshot: { totalMinor: number; totalAmount: number; currency: string };
}

export interface BookingChangePreview {
  bookingId: string;
  changeType: BookingChangeCommand['changeType'];
  current: BookingChangeSnapshot;
  proposed: BookingChangeSnapshot;
  /** proposed.totalMinor - current.totalMinor */
  priceDeltaMinor: number;
  currency: string;
  paymentImpact: PaymentImpact;
  bookingPaymentStatus?: string;
  /**
   * Present when the delta is negative. Refund policy is not defined, so the
   * API reports the impact only and never executes or promises a refund.
   */
  refundPolicy?: 'UNRESOLVED';
  /** Always false: change endpoints never move money. */
  settlementExecuted: false;
}

export interface BookingChangeResult extends Omit<BookingChangePreview, 'current' | 'proposed'> {
  changeId: string;
  booking: Booking;
}

/** The validated target of a change. Nothing is reserved when this is built. */
interface EvaluatedChange {
  original: BookingDdbItem;
  authHeader?: string;
  preview: BookingChangePreview;
  target: {
    vendorName?: string;
    branchName?: string;
    vehicleType: string;
    communityId?: string;
    durationMinutes: number;
    offeringName: string;
    categoryId?: string;
    offeringVersion: number;
    pricingSnapshot: PricingSnapshot;
    addOns: NonNullable<Booking['addOns']>;
  };
}

/**
 * Post-booking change of provider or service.
 *
 * Money handling is report-only: preview exposes the price delta and payment
 * impact, but neither preview nor commit charges or refunds anything. Refund
 * policy for a negative delta is undefined (see the release SUMMARY).
 */
export class BookingChangesService {
  private readonly logger = createChildLogger(baseLogger, { service: 'BookingChangesService' });

  constructor(
    private readonly bookings: BookingsRepository = getBookingsRepository(),
    private readonly changes: BookingChangesRepository = getBookingChangesRepository(),
    private readonly payments: PaymentsRepository = getPaymentsRepository(),
    private readonly catalog: CatalogGateway = getCatalogGateway(),
    private readonly vehicles: VehicleGateway = getVehicleGateway(),
    private readonly vendors: VendorGateway = getVendorGateway(),
    private readonly availability: AvailabilityGateway = getAvailabilityGateway(),
    private readonly users: UserGateway = getUserGateway(),
  ) {}

  async preview(request: LambdaRequest): Promise<BookingChangePreview> {
    const customerId = requireCustomerId(request);
    const command = validateBookingChange(request);
    const bookingId = pathBookingId(request);
    return (await this.evaluate(request, customerId, bookingId, command)).preview;
  }

  async commit(request: LambdaRequest): Promise<BookingChangeResult> {
    const customerId = requireCustomerId(request);
    const command = validateBookingChange(request);
    const bookingId = pathBookingId(request);
    const idempotencyKey = headerValue(request, 'Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    if (!command.expectedPrice) {
      throw new ValidationError('expectedPrice is required to commit a booking change');
    }
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');

    const replay = await this.changes.getIdempotency(customerId, bookingId, idempotencyKey);
    if (replay) {
      if (replay.requestHash !== hash) {
        throw new BookingError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different booking change',
          409,
          'Idempotency-Key',
        );
      }
      const current = await this.bookings.getBookingById(bookingId);
      if (!current) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
      return {
        bookingId,
        changeId: replay.changeId,
        changeType: command.changeType,
        booking: current,
        priceDeltaMinor: replay.priceDeltaMinor,
        currency: current.pricingSnapshot?.currency ?? command.expectedPrice.currency.toUpperCase(),
        paymentImpact: impactOf(replay.priceDeltaMinor),
        ...(replay.priceDeltaMinor < 0 ? { refundPolicy: 'UNRESOLVED' as const } : {}),
        settlementExecuted: false,
      };
    }

    const evaluated = await this.evaluate(request, customerId, bookingId, command);
    const { original, target, preview } = evaluated;

    // The original reservation is untouched until the booking swap succeeds.
    // The new capacity uses its own allocation key because Availability keys
    // allocations by id and never re-reserves a released one.
    const changeId = randomUUID();
    const newAllocationId = `${bookingId}-chg-${changeId.slice(0, 8)}`;
    const oldAllocationId = original.allocationId ?? original.id;

    const reservation = await this.reserveNew({
      command,
      customerId,
      newAllocationId,
      target,
      authorizationHeader: evaluated.authHeader,
    });

    const now = new Date().toISOString();
    const updated: Booking = {
      ...BookingsMapper.toDomain(original),
      vendorId: command.vendorId,
      vendorName: target.vendorName,
      branchId: command.branchId,
      branchName: target.branchName,
      serviceIds: [command.offeringId],
      offeringId: command.offeringId,
      offeringVersion: target.offeringVersion,
      service: {
        serviceId: command.offeringId,
        name: target.offeringName,
        ...(target.categoryId ? { categoryId: target.categoryId } : {}),
        offeringId: command.offeringId,
        durationMinutes: reservation.durationMinutes,
      },
      addOns: target.addOns,
      bookingDate: reservation.date,
      slotId: reservation.slotId,
      holdId: command.holdId,
      allocationId: newAllocationId,
      schedule: {
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        durationMinutes: reservation.durationMinutes,
        timezone: reservation.timezone,
        startAtUtc: civilTimeToUtc(reservation.date, reservation.startTime, reservation.timezone),
        endAtUtc: civilTimeToUtc(reservation.date, reservation.endTime, reservation.timezone),
      },
      pricingSnapshot: target.pricingSnapshot,
      totalAmount: target.pricingSnapshot.totalAmount,
    };

    const change: BookingChangeRecord = {
      changeId,
      bookingId,
      changeType: command.changeType,
      fromVendorId: original.vendorId,
      toVendorId: command.vendorId,
      ...(original.offeringId ? { fromOfferingId: original.offeringId } : {}),
      toOfferingId: command.offeringId,
      priceDeltaMinor: preview.priceDeltaMinor,
      paymentImpact: preview.paymentImpact,
      releasedAllocationId: oldAllocationId,
      allocationId: newAllocationId,
      createdAt: now,
    };

    try {
      await this.changes.commitChange({
        original,
        updated,
        change,
        customerId,
        idempotencyKey,
        requestHash: hash,
      });
    } catch (error) {
      // Failure: release only the new capacity; the original booking and its
      // allocation were never modified.
      await this.releaseQuietly(newAllocationId, bookingId);
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.changes.getIdempotency(customerId, bookingId, idempotencyKey);
        if (raced && raced.requestHash === hash) {
          const current = await this.bookings.getBookingById(bookingId);
          if (current) {
            return this.resultOf(raced.changeId, preview, current);
          }
        }
        throw new ConflictError('The booking changed while the change was being applied; review it and try again');
      }
      throw error;
    }

    // Success: the old capacity is no longer referenced by the booking.
    await this.releaseQuietly(oldAllocationId, bookingId);

    this.logger.info({
      event: 'booking_change_committed',
      bookingId,
      changeId,
      changeType: command.changeType,
      priceDeltaMinor: preview.priceDeltaMinor,
    });
    const committed = await this.bookings.getBookingById(bookingId);
    return this.resultOf(changeId, preview, committed ?? updated);
  }

  private resultOf(changeId: string, preview: BookingChangePreview, booking: Booking): BookingChangeResult {
    const { current: _current, proposed: _proposed, ...impact } = preview;
    return { ...impact, changeId, booking };
  }

  private async reserveNew(input: {
    command: BookingChangeCommand;
    customerId: string;
    newAllocationId: string;
    target: EvaluatedChange['target'];
    authorizationHeader?: string;
  }): Promise<ReservationSnapshot> {
    const { command, customerId, newAllocationId, target } = input;
    if (command.holdId) {
      const held = await this.availability.consumeHold({
        holdId: command.holdId,
        bookingId: newAllocationId,
        customerId,
      });
      try {
        assertHoldMatchesCommand(held, command, customerId);
      } catch (error) {
        await this.releaseQuietly(newAllocationId, newAllocationId);
        throw error;
      }
      return held;
    }
    return this.availability.reserveBooking({
      bookingId: newAllocationId,
      customerId,
      vendorId: command.vendorId,
      branchId: command.branchId,
      offeringId: command.offeringId,
      vehicleType: target.vehicleType,
      date: command.schedule.date,
      startTime: command.schedule.startTime,
      timezone: command.schedule.timezone,
      durationMinutes: target.durationMinutes,
      ...(target.communityId ? { communityId: target.communityId } : {}),
      authorizationHeader: input.authorizationHeader,
    });
  }

  private async releaseQuietly(allocationId: string, bookingId: string): Promise<void> {
    try {
      await this.availability.releaseAllocation(allocationId);
    } catch (error) {
      this.logger.error({
        event: 'booking_change_release_failed',
        bookingId,
        allocationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async evaluate(
    request: LambdaRequest,
    customerId: string,
    bookingId: string,
    command: BookingChangeCommand,
  ): Promise<EvaluatedChange> {
    const authHeader = authorizationHeader(request);
    const original = await this.bookings.getBookingDetailsItem(bookingId);
    if (!original) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
    if (!original.customerId || original.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to access this booking');
    }
    if (!CHANGEABLE_STATUSES.includes(original.bookingStatus)) {
      throw new BookingError(
        'BOOKING_NOT_CHANGEABLE',
        `Booking in ${original.bookingStatus} state cannot be changed`,
        409,
        'bookingId',
        false,
      );
    }
    // Package/plan linkage. Bookings do not carry a planId today (plans are
    // never converted to bookings), so this only fires if a linkage is added.
    const linkage = original as BookingDdbItem & { planId?: string; packageId?: string };
    if (linkage.planId || linkage.packageId) {
      throw new BookingError(
        'PACKAGE_CHANGE_NOT_ALLOWED',
        'Bookings that belong to a package plan cannot change provider or service',
        409,
        'bookingId',
        false,
      );
    }
    if (command.changeType === 'PROVIDER' && command.vendorId === original.vendorId) {
      throw new BookingError('CHANGE_NOT_APPLICABLE', 'A provider change must select a different provider', 409, 'vendorId', false);
    }
    if (command.changeType === 'SERVICE' && command.offeringId === original.offeringId) {
      throw new BookingError('CHANGE_NOT_APPLICABLE', 'A service change must select a different service', 409, 'offeringId', false);
    }
    if (original.bookingStatus === 'PENDING_PAYMENT') {
      await this.assertNoPaymentInFlight(bookingId);
    }
    const location = original.location;
    if (!location || !original.vehicleId || !original.pricingSnapshot) {
      throw new BookingError('BOOKING_NOT_CHANGEABLE', 'Booking has no snapshot that can be changed', 409, 'bookingId', false);
    }

    const [vehicle, eligibility, profile, offering] = await Promise.all([
      this.vehicles.getVehicle(original.vehicleId, authHeader),
      this.vendors.getCheckoutEligibility(command.vendorId, command.branchId),
      this.users.getProfile(customerId, authHeader),
      this.catalog.getOffering({
        offeringId: command.offeringId,
        vendorId: command.vendorId,
        authorizationHeader: authHeader,
      }),
    ]);
    assertVehicleOwnership(vehicle, customerId, original.vehicleId);
    assertVendorEligible(eligibility.vendor, command.vendorId);
    assertBranch(eligibility.branch, command);
    assertOffering(offering, command, vehicle.vehicleType);
    assertLocation({ location }, eligibility.vendor, profile);
    assertOfferingCommunity({
      enforced: communityOfferingEnforcementEnabled(),
      fulfilmentType: location.fulfilmentType,
      communityId: location.communityId,
      communities: offering.communities,
    });

    // Add-ons are vendor-owned; they carry over only when the vendor stays the same.
    const addOnIds = command.vendorId === original.vendorId ? (original.addOns ?? []).map((addOn) => addOn.id) : [];
    const price = await this.catalog.priceOffering({
      offeringId: command.offeringId,
      vendorId: command.vendorId,
      vehicleType: vehicle.vehicleType,
      addOnIds,
      authorizationHeader: authHeader,
    });
    const resolved = authoritativeOfferingVersion(price);
    const pricingSnapshot = buildPricingSnapshot({
      offeringId: command.offeringId,
      offeringVersion: resolved.offeringVersion,
      catalogVersion: resolved.catalogVersion,
      vendorPricingVersion: resolved.vendorPricingVersion,
      price,
    });
    if (command.expectedPrice) assertPlanExpectedPrice(command.expectedPrice, pricingSnapshot);

    const pricing = offering.vehiclePricing.find((entry: VehiclePricing) => entry.vehicleType === vehicle.vehicleType);
    if (!pricing || pricing.durationMinutes < 1) {
      throw new BookingError(
        'CATALOG_PRICING_UNAVAILABLE',
        'Service Catalog did not return a pricing for the vehicle type',
        502,
        'offeringId',
      );
    }

    const currentSnapshot = original.pricingSnapshot;
    const currentMinor = currentSnapshot.totalMinor ?? moneyToMinor(currentSnapshot.totalAmount);
    const priceDeltaMinor = pricingSnapshot.totalMinor - currentMinor;
    const paymentImpact = impactOf(priceDeltaMinor);
    const addOns = (price.items ?? [])
      .filter((line) => line.type === 'ADD_ON')
      .map((line) => ({ id: line.id, name: line.name, price: line.unitPrice, priceMinor: moneyToMinor(line.unitPrice) }));

    const preview: BookingChangePreview = {
      bookingId,
      changeType: command.changeType,
      current: {
        vendorId: original.vendorId,
        ...(original.vendorName ? { vendorName: original.vendorName } : {}),
        ...(original.branchId ? { branchId: original.branchId } : {}),
        ...(original.branchName ? { branchName: original.branchName } : {}),
        ...(original.offeringId ? { offeringId: original.offeringId } : {}),
        ...(original.service?.name ? { serviceName: original.service.name } : {}),
        ...(original.schedule
          ? { schedule: { date: original.schedule.date, startTime: original.schedule.startTime, endTime: original.schedule.endTime, timezone: original.schedule.timezone } }
          : {}),
        addOns: (original.addOns ?? []).map((addOn) => ({ id: addOn.id, name: addOn.name, price: addOn.price })),
        pricingSnapshot: { totalMinor: currentMinor, totalAmount: currentSnapshot.totalAmount, currency: currentSnapshot.currency },
      },
      proposed: {
        vendorId: command.vendorId,
        ...(eligibility.vendor.vendorName ? { vendorName: eligibility.vendor.vendorName } : {}),
        branchId: command.branchId,
        ...(eligibility.branch.branchName ? { branchName: eligibility.branch.branchName } : {}),
        offeringId: command.offeringId,
        serviceName: offering.name || command.offeringId,
        schedule: {
          date: command.schedule.date,
          startTime: command.schedule.startTime,
          timezone: command.schedule.timezone,
        },
        addOns: addOns.map((addOn) => ({ id: addOn.id, name: addOn.name, price: addOn.price })),
        pricingSnapshot: { totalMinor: pricingSnapshot.totalMinor, totalAmount: pricingSnapshot.totalAmount, currency: pricingSnapshot.currency },
      },
      priceDeltaMinor,
      currency: pricingSnapshot.currency,
      paymentImpact,
      bookingPaymentStatus: original.paymentStatus,
      ...(priceDeltaMinor < 0 ? { refundPolicy: 'UNRESOLVED' as const } : {}),
      settlementExecuted: false,
    };

    return {
      original,
      authHeader,
      preview,
      target: {
        vendorName: eligibility.vendor.vendorName,
        branchName: eligibility.branch.branchName,
        vehicleType: vehicle.vehicleType,
        ...(location.fulfilmentType === 'community' && location.communityId ? { communityId: location.communityId } : {}),
        durationMinutes: pricing.durationMinutes,
        offeringName: offering.name || command.offeringId,
        categoryId: offering.categoryId,
        offeringVersion: resolved.offeringVersion,
        pricingSnapshot,
        addOns,
      },
    };
  }

  /** A live checkout would be left paying a stale amount after the snapshot changes. */
  private async assertNoPaymentInFlight(bookingId: string): Promise<void> {
    const attempts = await this.payments.listBookingPayments(bookingId);
    const inFlight = attempts.some((payment) => payment.status === 'PENDING' && Date.parse(payment.expiresAt) > Date.now());
    if (inFlight) {
      throw new BookingError(
        'PAYMENT_IN_PROGRESS',
        'A payment is in progress for this booking; wait for it to finish or expire before changing it',
        409,
        'bookingId',
        false,
      );
    }
  }
}

function impactOf(priceDeltaMinor: number): PaymentImpact {
  if (priceDeltaMinor > 0) return 'CHARGE';
  if (priceDeltaMinor < 0) return 'REFUND';
  return 'NONE';
}

function pathBookingId(request: LambdaRequest): string {
  const value = request.pathParameters?.bookingId;
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('bookingId is required');
  return value.trim();
}

let service: BookingChangesService;

export function getBookingChangesService() {
  if (!service) service = new BookingChangesService();
  return service;
}
