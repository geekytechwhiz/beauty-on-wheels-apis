import {
    createChildLogger,
    createLogger
} from "@api-hub/observability";
import { EntityIdGenerator, LambdaRequest } from "@api-hub/utils";

import { bookingConfirmedIdempotencyKey, type BookingConfirmedPayload } from '@api-hub/event-platform';
import {
    BusinessRuleError,
    ConditionalWriteConflictError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError
} from "@api-hub/utils";
import { authorizationHeader, headerValue, requireCustomerId } from "../auth/access";
import { assertAdmin, callerUserId, isAdminRequest } from "../auth/admin";
import { actorDetails } from "../auth/vendor-operations";
import { isUnpaidOnlineBookingEnabled } from '../configs/env.config';
import {
    ReservationSnapshot,
    VehiclePricing,
    assertExpectedPrice,
    assertHoldMatchesCommand,
    assertOffering,
    assertOfferingCommunity,
    assertVehicleOwnership,
    assertVendorEligible,
    authoritativeOfferingVersion,
    buildPricingSnapshot,
    civilTimeToUtc,
    communityOfferingEnforcementEnabled,
    moneyToMinor,
    payableAmount,
    requestFingerprint
} from "../domain/create-booking";
import { BookingError } from "../errors";
import { AvailabilityGateway, getAvailabilityGateway } from "../integrations/availability.client";
import { CatalogGateway, getCatalogGateway } from "../integrations/catalog.client";
import { isRazorpayCheckoutConfigured } from '../integrations/razorpay.client';
import { UserGateway, getUserGateway } from "../integrations/user.client";
import { VehicleGateway, getVehicleGateway } from "../integrations/vehicle.client";
import {
    OperationalAccessGateway,
    VendorGateway,
    getOperationalAccessGateway,
    getVendorGateway,
} from "../integrations/vendor.client";
import { BookingsMapper } from "../mappers/bookings.mapper";
import {
    BookingsRepository,
    getBookingsRepository
} from "../repositories/bookings.repository";
import { validateCreateBooking } from "../schemas/bookings.schema";
import { Booking } from "../types/api-types";
import { BookingDdbItem, BookingIdempotencyItem } from "../types/repository.types";
import { getCustomerPlansService } from "./customer-plans.service";

type BookingCreationPaymentPlan = {
    paymentMethod: 'CASH_ON_SERVICE' | 'ONLINE';
    bookingStatus: 'PENDING_PAYMENT' | 'CONFIRMED';
    publishConfirmation: boolean;
};

type BookingConfirmationSource = Pick<Booking,
    'id' | 'customerId' | 'vendorId' | 'vendorName' | 'bookingDate' | 'slotId' | 'totalAmount'
> & {
    customerEmail?: string;
    customerName?: string;
};

const baseLogger = createLogger({
    service: "bookings-service",
    redactPII: true,
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['CONFIRMED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: []
};

export class BookingsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "BookingsService"
            }
        );

    constructor(
        private readonly repository: BookingsRepository = getBookingsRepository(),
        private readonly catalog: CatalogGateway = getCatalogGateway(),
        private readonly vehicles: VehicleGateway = getVehicleGateway(),
        private readonly vendors: VendorGateway = getVendorGateway(),
        private readonly availability: AvailabilityGateway = getAvailabilityGateway(),
        private readonly users: UserGateway = getUserGateway(),
        private readonly operationalAccess: OperationalAccessGateway = getOperationalAccessGateway(),
    ) {}

    /**
     * Customer booking history. Identity comes from the authorizer; path
     * customerId may only match self unless the caller is a platform admin.
     * Vendor and community lists use dedicated routes.
     */
    async getbookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const requestedCustomerId = (
            request.pathParameters?.customerId ?? request.params?.customerId
        )?.trim();
        const vendorId = (
            request.pathParameters?.vendorId ?? request.params?.vendorId
        )?.trim();
        const communityId = (
            request.pathParameters?.communityId ?? request.params?.communityId
        )?.trim();

        if (vendorId) {
            throw new ForbiddenError(
                "Use GET /vendors/{vendorId}/bookings for vendor booking lists",
            );
        }
        if (communityId) {
            throw new ForbiddenError(
                "Use GET /communities/{communityId}/bookings for community booking lists",
            );
        }

       

        this.logger.info({
          event: 'getbookings_start',
          customerId: requestedCustomerId,
          correlationId,
        });

        try {
            const bookings =
              await this.repository.getCustomerBookings(requestedCustomerId);

            this.logger.info({
                event: "getbookings_success",
                count: bookings.length,
                correlationId
            });

            return bookings;
        } catch (error: any) {
            this.logger.error({
                event: "getbookings_failed",
                error: error.message,
                correlationId
            });
            throw error;
        }
    }

    /** Vendor owner or platform admin: bookings for the path vendor. */
    async getvendorbookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const vendorId = (
            request.pathParameters?.vendorId ?? request.params?.vendorId
        )?.trim();
        if (!vendorId) {
            throw new ValidationError("vendorId is required");
        }
 

        this.logger.info({
            event: "getvendorbookings_start",
            vendorId,
            correlationId,
        });

        const bookings = await this.repository.getVendorBookings(vendorId);

        this.logger.info({
            event: "getvendorbookings_success",
            vendorId,
            count: bookings.length,
            correlationId,
        });

        return bookings;
    }

    /**
     * Community booking list. Platform admin sees all bookings for the community.
     * Vendor owners see only their own bookings in that community.
     */
    async getcommunitybookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const communityId = (
            request.pathParameters?.communityId ?? request.params?.communityId
        )?.trim();
        if (!communityId) {
            throw new ValidationError("communityId is required");
        }

        this.logger.info({
            event: "getcommunitybookings_start",
            communityId,
            correlationId,
        });

        const bookings = await this.repository.getCommunityBookings(communityId);

        

        this.logger.info({
            event: "getcommunitybookings_success",
            communityId,
            count: bookings.length,
            correlationId,
        });

        return bookings;
    }

    /** Platform admin: all bookings via GSI1 BOOKING_LIST. */
    async getadminbookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const adminId = assertAdmin(request);

        this.logger.info({
            event: "getadminbookings_start",
            adminId,
            correlationId,
        });

        const bookings = await this.repository.listAllBookings();

        this.logger.info({
            event: "getadminbookings_success",
            count: bookings.length,
            correlationId,
        });

        return bookings;
    }

    async postbookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const customerId = requireCustomerId(request);
        const command = validateCreateBooking(request);
        const paymentPlan = this.bookingCreationPaymentPlan(command.paymentMethod);
        this.logger.info({
            event: "postbookings_start",
            command: command,
            correlationId,
        });
        const idempotencyKey = headerValue(request, "Idempotency-Key");
        if (!idempotencyKey || idempotencyKey.length > 128) {
            throw new ValidationError("Idempotency-Key header is required");
        }
        const hash = requestFingerprint(command);
        const authHeader = authorizationHeader(request);

        this.logger.info({
            event: "postbookings_start",
            vendorId: command.vendorId,
            branchId: command.branchId,
            offeringId: command.offeringId,
            date: command.schedule.date,
            startTime: command.schedule.startTime,
            correlationId,
        });

        const existing = await this.repository.getIdempotency(customerId, idempotencyKey);
        if (existing) {
            return this.resume(existing, hash, correlationId);
        }

        // Checkout eligibility, catalog price, and availability reservation are the
        // booking authorization. The vendor readiness projection is not consulted.
        const [vehicle, eligibility, profile, offering] = await Promise.all([
            this.vehicles.getVehicle(command.vehicleId, authHeader),
            this.vendors.getCheckoutEligibility(command.vendorId, command.branchId),
            this.users.getProfile(customerId, authHeader),
            this.catalog.getOffering({
                offeringId: command.offeringId,
                vendorId: command.vendorId,
                authorizationHeader: authHeader,
            }),
        ]);

        assertVehicleOwnership(vehicle, customerId, command.vehicleId);
        assertVendorEligible(eligibility.vendor, command.vendorId);
      
        assertOffering(offering, command, vehicle.vehicleType);
        // assertLocation(command, eligibility.vendor, profile);
        assertOfferingCommunity({
            enforced: communityOfferingEnforcementEnabled(),
            fulfilmentType: command.location.fulfilmentType,
            communityId: command.location.communityId,
            communities: offering.communities,
        });
        const addressDetails = command.location.addressId
            ? await this.users.assertAddress(customerId, command.location.addressId, authHeader)
            : undefined;

        const price = await this.catalog.priceOffering({
            offeringId: command.offeringId,
            vendorId: command.vendorId,
            vehicleType: vehicle.vehicleType,
            addOnIds: command.addOnIds,
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
        this.logger.info({
            event: "postbookings_pricingSnapshot",
            pricingSnapshot: pricingSnapshot,
            correlationId,
        });
        assertExpectedPrice(command.expectedPrice, pricingSnapshot);
        const { vehiclePricing } = offering;
        const pricing = vehiclePricing.find((v:VehiclePricing) => v.vehicleType === vehicle.vehicleType);
       this.logger.info({
        event: "postbookings_pricing",
        pricing: pricing,
        correlationId,
       });
        if (!pricing) {
          throw new BookingError(
            'CATALOG_PRICING_UNAVAILABLE',
            'Service Catalog did not return a pricing for the vehicle type',
            502,
            'offeringId',
          );
        }
        if (pricing.durationMinutes && pricing.durationMinutes < 1) {
          throw new BookingError(
            'CATALOG_PRICING_UNAVAILABLE',
            'Service Catalog did not return an offering duration',
            502,
            'offeringId',
          );
        }
       
        const bookingId = EntityIdGenerator.BookingId();
        let reservation: ReservationSnapshot;
        if (command.holdId) {
            const held = await this.availability.consumeHold({
                holdId: command.holdId,
                bookingId,
                customerId,
            });
            try {
                assertHoldMatchesCommand(held, command, customerId);
            } catch (error) {
                await this.releaseReservationQuietly(bookingId, correlationId);
                throw error;
            }
            reservation = held;
        } else {
            reservation = await this.availability.reserveBooking({
                bookingId,
                customerId,
                vendorId: command.vendorId,
                branchId: command.branchId,
                offeringId: command.offeringId,
                vehicleType: vehicle.vehicleType,
                date: command.schedule.date,
                startTime: command.schedule.startTime,
                timezone: command.schedule.timezone,
                durationMinutes: pricing.durationMinutes,
                ...(command.location.fulfilmentType === 'community' ? { communityId: command.location.communityId } : {}),
                authorizationHeader: authHeader,
            });
        }

        const booking: Booking = {
            id: bookingId,
            reference: `BOW-${bookingId.slice(0, 8).toUpperCase()}`,
            customerId,
            vendorId: command.vendorId,
            vendorName: eligibility.vendor.vendorName,
            branchId: command.branchId,
            branchName: eligibility.branch.branchName,
            vehicleId: command.vehicleId,
            vehicleDetails: {
                bodyCategory: vehicle.vehicleType,
                type: vehicle.vehicleType,
                brand: vehicle.brand,
                model: vehicle.model,
                registrationNumber: vehicle.registrationNumber,
                ...([vehicle.brand, vehicle.model].filter(Boolean).length
                    ? { makeModel: [vehicle.brand, vehicle.model].filter(Boolean).join(" ") }
                    : {}),
            },
            serviceIds: [command.offeringId],
            offeringId: command.offeringId,
            offeringVersion: resolved.offeringVersion,
            service: {
                serviceId: command.offeringId,
                name: offering.name || command.offeringId,
                ...(offering.categoryId ? { categoryId: offering.categoryId } : {}),
                offeringId: command.offeringId,
                durationMinutes: reservation.durationMinutes,
            },
            addOns: (price.items || []).filter((line) => line.type === 'ADD_ON').map((line) => ({
                id: line.id, name: line.name, price: line.unitPrice, priceMinor: moneyToMinor(line.unitPrice),
            })),
            bookingDate: reservation.date,
            slotId: reservation.slotId,
            ...(command.holdId ? { holdId: command.holdId } : {}),
            schedule: {
                date: reservation.date,
                startTime: reservation.startTime,
                endTime: reservation.endTime,
                durationMinutes: reservation.durationMinutes,
                timezone: reservation.timezone,
                startAtUtc: civilTimeToUtc(reservation.date, reservation.startTime, reservation.timezone),
                endAtUtc: civilTimeToUtc(reservation.date, reservation.endTime, reservation.timezone),
            },
            location: {
                ...command.location,
                ...(addressDetails ? { details: addressDetails } : {}),
            },
            notes: command.notes,
            pricingSnapshot,
            totalAmount: pricingSnapshot.totalAmount,
            paymentMethod: paymentPlan.paymentMethod,
            paymentStatus: "PENDING",
            bookingStatus: paymentPlan.bookingStatus,
            slotReserved: true,
        };

        try {
            const contact = {
                customerEmail: profile.email,
                customerName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || undefined,
            };
            const outbox = paymentPlan.publishConfirmation
                ? this.bookingConfirmedOutbox({ ...booking, ...contact })
                : undefined;
            await this.repository.createBooking(booking, {
                idempotencyKey,
                requestHash: hash,
            }, contact, outbox);
        } catch (error) {
            if (error instanceof ConditionalWriteConflictError) {
                await this.releaseReservationQuietly(bookingId, correlationId);
                return this.resumeAfterConflict(customerId, idempotencyKey, hash, correlationId);
            }
            await this.releaseReservationQuietly(bookingId, correlationId);
            this.logger.error({
                event: "postbookings_persist_failed",
                bookingId: booking.id,
                correlationId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }

        this.logger.info({
            event: "postbookings_success",
            bookingId: booking.id,
            payableAmount: payableAmount(booking),
            correlationId,
        });
        return booking;
    }

    async getbookingid(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const bookingId = request.pathParameters?.bookingId;

        this.logger.info({
            event: "getbookingid_start",
            bookingId,
            correlationId
        });

        if (!bookingId) {
            throw new ValidationError("bookingId is required");
        }

        const booking = await this.repository.getBookingById(bookingId);
        if (!booking) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        await this.assertCanReadBooking(request, booking);

        this.logger.info({
            event: "getbookingid_success",
            bookingId,
            correlationId
        });

        return booking;
    }

    async putbookingid(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const bookingId = request.pathParameters?.bookingId;
        const body = request.body as Booking;

        this.logger.info({
            event: "putbookingid_start",
            bookingId,
            body,
            correlationId
        });

        if (!bookingId) {
            throw new ValidationError("bookingId is required");
        }

        // Fetch original
        const originalItem = await this.repository.getBookingDetailsItem(bookingId);
        if (!originalItem) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        this.assertCustomerOwnsBooking(request, originalItem.customerId);

        // Creation snapshots are authoritative. Generic updates cannot bypass
        // vehicle, service, pricing, schedule, or capacity validation.
        const attempted = Object.keys(body ?? {}).filter((key) => key !== 'notes');
        if (attempted.length > 0) {
            throw new BusinessRuleError(
                'Booking snapshots are immutable; create a new booking to change service, schedule, vehicle, or location',
            );
        }
        if (originalItem.bookingStatus !== 'PENDING_PAYMENT') {
            throw new BusinessRuleError(`Cannot update booking in ${originalItem.bookingStatus} state`);
        }
        const updatedBooking: Booking = {
            ...BookingsMapper.toDomain(originalItem),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
        };

        try {
            await this.repository.updateBooking(updatedBooking, originalItem);

            this.logger.info({
                event: "putbookingid_success",
                bookingId,
                correlationId
            });

            return { id: bookingId, ...updatedBooking };
        } catch (error: any) {
            this.logger.error({
                event: "putbookingid_failed",
                error: error.message,
                correlationId
            });

            if (error instanceof ConditionalWriteConflictError) {
                throw new ConflictError("Conflict updating booking. Either version mismatch or slot already booked.");
            }
            throw error;
        }
    }

    async deletebookingid(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const bookingId = request.pathParameters?.bookingId;

        this.logger.info({
            event: "deletebookingid_start",
            bookingId,
            correlationId
        });

        if (!bookingId) {
            throw new ValidationError("bookingId is required");
        }

        const original = await this.repository.getBookingDetailsItem(bookingId);
        if (!original) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        this.assertCustomerOwnsBooking(request, original.customerId);

        // Check if cancellable
        const allowedToCancel = ['CREATED', 'CONFIRMED', 'PENDING'];
        if (!allowedToCancel.includes(original.bookingStatus)) {
            throw new BusinessRuleError(`Cannot cancel booking in ${original.bookingStatus} state`);
        }

        try {
            await this.cancelAndRelease(original);

            this.logger.info({
                event: "deletebookingid_success",
                bookingId,
                correlationId
            });
        } catch (error: any) {
            this.logger.error({
                event: "deletebookingid_failed",
                error: error.message,
                correlationId
            });
            if (error instanceof ConditionalWriteConflictError) {
                throw new ConflictError("Concurrency conflict while cancelling booking.");
            }
            throw error;
        }
    }

    async postconfirm(_request: LambdaRequest) {
        // Deliberately retained only for backwards-compatible in-process callers.
        // It is not registered as an HTTP handler. Payment confirmation must use
        // confirmPaidBooking after trusted gateway verification.
        throw new ForbiddenError('Bookings can only be confirmed by verified payment processing');
    }

    async postcheckin(request: LambdaRequest) {
        return this.transitionStatus(request, 'CHECKED_IN');
    }

    async poststart(request: LambdaRequest) {
        return this.transitionStatus(request, 'IN_PROGRESS');
    }

    async postcomplete(request: LambdaRequest) {
        return this.transitionStatus(request, 'COMPLETED');
    }

    async postcancel(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const bookingId = request.pathParameters?.bookingId;

        this.logger.info({
            event: "postcancel_start",
            bookingId,
            correlationId
        });

        if (!bookingId) {
            throw new ValidationError("bookingId is required");
        }

        const original = await this.repository.getBookingDetailsItem(bookingId);
        if (!original) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        this.assertCustomerOwnsBooking(request, original.customerId);

        // Validate transition
        this.validateStateTransition(original.bookingStatus, 'CANCELLED');

        try {
            await this.cancelAndRelease(original);

            this.logger.info({
                event: "postcancel_success",
                bookingId,
                correlationId
            });

            return { id: bookingId, bookingStatus: 'CANCELLED' };
        } catch (error: any) {
            this.logger.error({
                event: "postcancel_failed",
                error: error.message,
                correlationId
            });
            if (error instanceof ConditionalWriteConflictError) {
                throw new ConflictError("Concurrency conflict while cancelling booking.");
            }
            throw error;
        }
    }

    private async transitionStatus(request: LambdaRequest, targetStatus: Booking['bookingStatus']) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const bookingId = request.pathParameters?.bookingId;

        this.logger.info({
            event: "transitionStatus_start",
            bookingId,
            targetStatus,
            correlationId
        });

        if (!bookingId) {
            throw new ValidationError("bookingId is required");
        }

        const original = await this.repository.getBookingDetailsItem(bookingId);
        if (!original) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        this.assertCustomerOwnsBooking(request, original.customerId);

        // Validate transition
        this.validateStateTransition(original.bookingStatus, targetStatus!);

        try {
            await this.repository.updateBookingStatus(targetStatus, original);

            if (targetStatus === 'IN_PROGRESS' && original.planId) {
                await getCustomerPlansService().markFirstJobStarted(
                    original.planId,
                    original.id,
                    new Date().toISOString(),
                );
            }

            this.logger.info({
                event: "transitionStatus_success",
                bookingId,
                targetStatus,
                correlationId
            });

            return { id: bookingId, bookingStatus: targetStatus };
        } catch (error: any) {
            this.logger.error({
                event: "transitionStatus_failed",
                error: error.message,
                correlationId
            });
            if (error instanceof ConditionalWriteConflictError) {
                throw new ConflictError(`Concurrency conflict while transitioning booking to ${targetStatus}.`);
            }
            throw error;
        }
    }

    private async resume(
        record: BookingIdempotencyItem,
        hash: string,
        _correlationId: string,
    ): Promise<Booking> {
        if (record.requestHash !== hash) {
            throw new BookingError(
                "IDEMPOTENCY_CONFLICT",
                "Idempotency key was already used for a different booking request",
                409,
                "Idempotency-Key",
            );
        }
        const item = await this.repository.getBookingDetailsItem(record.bookingId);
        if (!item) {
            throw new NotFoundError(`Booking with ID ${record.bookingId} not found`);
        }
        if (item.bookingStatus === "CANCELLED") {
            throw new BookingError(
                "ALLOCATION_FAILED",
                "Booking capacity reservation was released. Start again with a new idempotency key.",
                409,
                "Idempotency-Key",
            );
        }
        return BookingsMapper.toDomain(item);
    }

    private async resumeAfterConflict(
        customerId: string,
        idempotencyKey: string,
        hash: string,
        correlationId: string,
    ): Promise<Booking> {
        const existing = await this.repository.getIdempotency(customerId, idempotencyKey);
        if (existing) {
            return this.resume(existing, hash, correlationId);
        }
        throw new ConflictError("The booking request was processed concurrently; retry with the same idempotency key");
    }

    private async cancelAndRelease(original: BookingDdbItem): Promise<void> {
        // Package-plan jobs do not reserve Availability capacity.
        if (!original.planId && !original.packageId) {
            await this.availability.releaseAllocation(original.allocationId ?? original.id);
        }
        await this.repository.cancelBooking(original);
    }

    private async releaseReservationQuietly(bookingId: string, correlationId: string): Promise<void> {
        try {
            await this.availability.releaseAllocation(bookingId);
        } catch (error) {
            this.logger.error({
                event: 'booking_reservation_compensation_failed', bookingId, correlationId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private validateStateTransition(currentStatus: string, targetStatus: string) {
        const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
        if (!allowedTransitions.includes(targetStatus)) {
            throw new BusinessRuleError(`Invalid booking status transition: ${currentStatus} -> ${targetStatus}`);
        }
    }

    /**
     * Legacy requests retain their historic PENDING_PAYMENT workflow. Explicit
     * payment choices make the distinction visible to new mobile clients.
     */
    private bookingCreationPaymentPlan(method?: 'CASH_ON_SERVICE' | 'ONLINE'): BookingCreationPaymentPlan {
        if (method === 'CASH_ON_SERVICE') {
            return {
                paymentMethod: method,
                bookingStatus: 'CONFIRMED',
                publishConfirmation: true,
            };
        }
        if (method === 'ONLINE') {
            if (isRazorpayCheckoutConfigured()) {
                return {
                    paymentMethod: method,
                    bookingStatus: 'PENDING_PAYMENT',
                    publishConfirmation: false,
                };
            }
            if (isUnpaidOnlineBookingEnabled()) {
                return {
                    paymentMethod: method,
                    bookingStatus: 'CONFIRMED',
                    publishConfirmation: true,
                };
            }
            throw new BookingError(
                'ONLINE_PAYMENT_UNAVAILABLE',
                'Online booking requires configured Razorpay checkout or ALLOW_UNPAID_ONLINE_BOOKING outside production',
                503,
                'paymentMethod',
                true,
            );
        }
        return {
            paymentMethod: 'ONLINE',
            bookingStatus: 'PENDING_PAYMENT',
            publishConfirmation: false,
        };
    }

    /**
     * Direct-Lambda integration point for a future Payment Service. This method
     * is intentionally not reachable from API Gateway. The caller must have
     * already verified the payment gateway event and must provide the immutable
     * booking amount/currency it settled.
     */
    async confirmPaidBooking(input: {
        bookingId?: unknown;
        amount?: unknown;
        currency?: unknown;
    }): Promise<Booking> {
        const bookingId = typeof input.bookingId === 'string' ? input.bookingId.trim() : '';
        if (!bookingId) {
            throw new ValidationError('bookingId is required');
        }
        const original = await this.repository.getBookingDetailsItem(bookingId);
        if (!original) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        if (original.bookingStatus === 'CONFIRMED' && original.paymentStatus === 'PAID') {
            return BookingsMapper.toDomain(original);
        }
        if (!['PENDING', 'CREATED', 'PENDING_PAYMENT'].includes(original.bookingStatus) || original.paymentStatus !== 'PENDING') {
            throw new BusinessRuleError(`Booking ${bookingId} is not awaiting payment`);
        }
        const expectedAmount = payableAmount(BookingsMapper.toDomain(original));
        const expectedCurrency = original.pricingSnapshot?.currency;
        if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount !== expectedAmount) {
            throw new BookingError('PAYMENT_AMOUNT_MISMATCH', 'Payment amount does not match the booking', 409, 'amount');
        }
        if (typeof input.currency !== 'string' || input.currency.toUpperCase() !== expectedCurrency?.toUpperCase()) {
            throw new BookingError('PAYMENT_CURRENCY_MISMATCH', 'Payment currency does not match the booking', 409, 'currency');
        }
        const outbox = this.bookingConfirmedOutbox(original);
        if (outbox) {
            await this.repository.updateBookingStatus('CONFIRMED', original, 'PAID', outbox);
        } else {
            await this.repository.updateBookingStatus('CONFIRMED', original, 'PAID');
        }
        const confirmed = await this.repository.getBookingById(bookingId);
        if (!confirmed) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        return confirmed;
    }

    /**
     * Confirmation emails are deliberately dispatched from a DynamoDB-stream
     * outbox. The payment response therefore never waits on Email Service,
     * while the status change and publish intent remain atomic.
     */
    private bookingConfirmedOutbox(original: BookingConfirmationSource): {
        eventId: string;
        idempotencyKey: string;
        correlationId: string;
        payload: BookingConfirmedPayload;
    } | undefined {
        const email = original.customerEmail?.trim();
        if (!email || !original.id || !original.customerId || !original.vendorId || !original.bookingDate || !original.slotId) {
            this.logger.warn({
                event: 'booking_confirmation_event_skipped',
                bookingId: original.id,
                reason: 'missing_notification_snapshot',
            });
            return undefined;
        }
        const eventId = bookingConfirmedIdempotencyKey(original.id);
        return {
            eventId,
            idempotencyKey: eventId,
            correlationId: `booking-confirmed:${original.id}`,
            payload: {
                bookingId: original.id,
                customerId: original.customerId,
                vendorId: original.vendorId,
                customerEmail: email,
                bookingDate: original.bookingDate,
                slotId: original.slotId,
                bookingStatus: 'confirmed',
                ...(typeof original.totalAmount === 'number' ? { totalAmount: original.totalAmount } : {}),
                ...(original.customerName ? { customerName: original.customerName } : {}),
                ...(original.vendorName ? { vendorName: original.vendorName } : {}),
            },
        };
    }

    /** Trusted payment failure/timeout callback. It is idempotent and always releases capacity. */
    async failPaymentBooking(input: { bookingId?: unknown }): Promise<Booking> {
        const bookingId = typeof input.bookingId === 'string' ? input.bookingId.trim() : '';
        if (!bookingId) throw new ValidationError('bookingId is required');
        const original = await this.repository.getBookingDetailsItem(bookingId);
        if (!original) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        if (original.bookingStatus === 'CONFIRMED' || original.paymentStatus === 'PAID') {
            throw new BusinessRuleError(`Booking ${bookingId} has already been paid`);
        }
        if (original.bookingStatus !== 'CANCELLED') {
            await this.availability.releaseAllocation(original.allocationId ?? bookingId);
            await this.repository.updateBookingStatus('CANCELLED', original, 'FAILED');
        }
        const cancelled = await this.repository.getBookingById(bookingId);
        if (!cancelled) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        return cancelled;
    }

    private assertCustomerOwnsBooking(request: LambdaRequest, bookingCustomerId?: string): void {
        const customerId = requireCustomerId(request);
        if (!bookingCustomerId || bookingCustomerId !== customerId) {
            throw new ForbiddenError('Not authorized to access this booking');
        }
    }

    /** Customer owner, vendor owner of the booking's vendor, or platform admin. */
    private async assertCanReadBooking(request: LambdaRequest, booking: Booking): Promise<void> {
        if (isAdminRequest(request)) {
            assertAdmin(request);
            return;
        }

        const userId = callerUserId(request);
        if (!userId) {
            throw new ForbiddenError('Not authorized to access this booking');
        }

        if (booking.customerId && booking.customerId === userId) {
            return;
        }

        if (booking.vendorId) {
            const membership = await this.operationalAccess.getOperationalAccess(userId);
            if (
                membership.active
                && membership.role === 'owner'
                && membership.vendorId === booking.vendorId
            ) {
                return;
            }
        }

        throw new ForbiddenError('Not authorized to access this booking');
    }
}

let service: BookingsService;

export function getBookingsService() {
    if (!service) {
        service = new BookingsService();
    }
    return service;
}
