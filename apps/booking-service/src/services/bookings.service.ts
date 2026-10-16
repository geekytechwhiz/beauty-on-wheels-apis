import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";
import { randomUUID } from "crypto";

import {
    BookingsRepository,
    getBookingsRepository
} from "../repositories/bookings.repository";
import {
    ValidationError,
    ConflictError,
    NotFoundError,
    BusinessRuleError,
    ForbiddenError,
    ConditionalWriteConflictError
} from "@api-hub/utils";
import { Booking } from "../types/api-types";
import { authorizationHeader, headerValue, requireCustomerId } from "../auth/access";
import {
    assertBranch,
    assertHold,
    assertLocation,
    assertOffering,
    assertSlot,
    assertVehicleOwnership,
    assertVendorEligible,
    authoritativeOfferingVersion,
    buildPricingSnapshot,
    payableAmount,
    requestFingerprint,
} from "../domain/create-booking";
import { BookingError } from "../errors";
import { AvailabilityGateway, getAvailabilityGateway } from "../integrations/availability.client";
import { CatalogGateway, getCatalogGateway } from "../integrations/catalog.client";
import { UserGateway, getUserGateway } from "../integrations/user.client";
import { VehicleGateway, getVehicleGateway } from "../integrations/vehicle.client";
import { VendorGateway, getVendorGateway } from "../integrations/vendor.client";
import { BookingsMapper } from "../mappers/bookings.mapper";
import { validateCreateBooking } from "../schemas/bookings.schema";
import { BookingDdbItem, BookingIdempotencyItem } from "../types/repository.types";

const baseLogger = createLogger({
    service: "bookings-service",
    redactPII: true,
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['CONFIRMED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
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
        private readonly now: () => Date = () => new Date(),
    ) {}

    /**
     * Customer-facing booking history.  The customer id is always derived from
     * the authorizer context; query/path parameters are never authority.
     */
    async getbookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const customerId = requireCustomerId(request);
        const requestedCustomerId = request.params?.customerId as string | undefined;
        const vendorId = request.params?.vendorId as string | undefined;

        if (requestedCustomerId && requestedCustomerId !== customerId) {
            throw new ForbiddenError("Not authorized to view another customer's bookings");
        }
        if (vendorId) {
            throw new ForbiddenError("Customer booking history cannot be filtered by vendor identity");
        }

        this.logger.info({
            event: "getbookings_start",
            customerId,
            vendorId,
            correlationId
        });

        try {
            const bookings = await this.repository.getCustomerBookings(customerId);

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

    async postbookings(request: LambdaRequest) {
        const correlationId = (request.context as any)?.correlationId || "unknown";
        const customerId = requireCustomerId(request);
        const command = validateCreateBooking(request);
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
            slotId: command.slotId,
            holdId: command.holdId,
            correlationId,
        });

        const existing = await this.repository.getIdempotency(customerId, idempotencyKey);
        if (existing) {
            return this.resume(existing, hash, correlationId);
        }

        const [vehicle, eligibility, slot, hold, profile, offering] = await Promise.all([
            this.vehicles.getVehicle(command.vehicleId, authHeader),
            this.vendors.getCheckoutEligibility(command.vendorId, command.branchId),
            this.availability.getSlot(command.slotId, authHeader),
            this.availability.getHold(command.holdId, authHeader),
            this.users.getProfile(customerId, authHeader),
            this.catalog.getOffering({
                offeringId: command.offeringId,
                vendorId: command.vendorId,
                authorizationHeader: authHeader,
            }),
        ]);

        assertVehicleOwnership(vehicle, customerId, command.vehicleId);
        assertVendorEligible(eligibility.vendor, command.vendorId);
        assertBranch(eligibility.branch, command);
        assertOffering(offering, command, vehicle.vehicleType);
        assertSlot(slot, command, vehicle.vehicleType);
        assertHold(hold, command, customerId, this.now());
        assertLocation(command, eligibility.vendor, profile);
        if (command.location.addressId) {
            await this.users.assertAddress(customerId, command.location.addressId, authHeader);
        }

        const price = await this.catalog.priceOffering({
            offeringId: command.offeringId,
            vendorId: command.vendorId,
            vehicleType: vehicle.vehicleType,
            authorizationHeader: authHeader,
        });
        const resolved = authoritativeOfferingVersion(price);
        if (resolved.offeringVersion !== command.offeringVersion) {
            throw new BookingError(
                "OFFERING_VERSION_MISMATCH",
                "Offering version does not match the current offering revision",
                409,
                "offeringVersion",
            );
        }
        const pricingSnapshot = buildPricingSnapshot({
            offeringId: command.offeringId,
            offeringVersion: resolved.offeringVersion,
            catalogVersion: resolved.catalogVersion,
            vendorPricingVersion: resolved.vendorPricingVersion,
            price,
        });

        const booking: Booking = {
            id: randomUUID(),
            customerId,
            vendorId: command.vendorId,
            branchId: command.branchId,
            vehicleId: command.vehicleId,
            vehicleDetails: {
                bodyCategory: vehicle.vehicleType,
                ...([vehicle.brand, vehicle.model].filter(Boolean).length
                    ? { makeModel: [vehicle.brand, vehicle.model].filter(Boolean).join(" ") }
                    : {}),
            },
            serviceIds: [command.offeringId],
            offeringId: command.offeringId,
            offeringVersion: resolved.offeringVersion,
            bookingDate: slot.date,
            slotId: command.slotId,
            holdId: command.holdId,
            location: command.location,
            pricingSnapshot,
            totalAmount: pricingSnapshot.totalAmount,
            paymentStatus: "PENDING",
            bookingStatus: "PENDING",
        };

        try {
            await this.repository.createBooking(booking, {
                idempotencyKey,
                requestHash: hash,
            });
        } catch (error) {
            if (error instanceof ConditionalWriteConflictError) {
                return this.resumeAfterConflict(customerId, idempotencyKey, hash, command.holdId, correlationId);
            }
            this.logger.error({
                event: "postbookings_persist_failed",
                bookingId: booking.id,
                correlationId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }

        const secured = await this.secureAllocation(booking.id!, correlationId);
        this.logger.info({
            event: "postbookings_success",
            bookingId: secured.id,
            payableAmount: payableAmount(secured),
            correlationId,
        });
        return secured;
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
        this.assertCustomerOwnsBooking(request, booking.customerId);

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

        // Check if reschedule is allowed
        const allowedToUpdate = ['CREATED', 'CONFIRMED', 'PENDING'];
        if (!allowedToUpdate.includes(originalItem.bookingStatus)) {
            throw new BusinessRuleError(`Cannot update booking in ${originalItem.bookingStatus} state`);
        }

        const updatedBooking: Booking = {
            ...originalItem,
            ...body,
            id: bookingId,
            bookingStatus: originalItem.bookingStatus, // keep status unchanged
            paymentStatus: originalItem.paymentStatus
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
        correlationId: string,
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
        if (item.bookingStatus === "PENDING") {
            return this.secureAllocation(item.id, correlationId);
        }
        if (item.bookingStatus === "CANCELLED") {
            throw new BookingError(
                "ALLOCATION_FAILED",
                "Booking allocation was not secured. Start again with a new hold and idempotency key.",
                409,
                "holdId",
            );
        }
        return BookingsMapper.toDomain(item);
    }

    private async resumeAfterConflict(
        customerId: string,
        idempotencyKey: string,
        hash: string,
        holdId: string,
        correlationId: string,
    ): Promise<Booking> {
        const existing = await this.repository.getIdempotency(customerId, idempotencyKey);
        if (existing) {
            return this.resume(existing, hash, correlationId);
        }
        const holdBooking = await this.repository.getHoldBooking(holdId);
        if (holdBooking && holdBooking.customerId !== customerId) {
            throw new BookingError("HOLD_ALREADY_CONSUMED", "Hold is already consumed", 409, "holdId");
        }
        throw new ConflictError("The selected hold is already reserved");
    }

    private async secureAllocation(bookingId: string, correlationId: string): Promise<Booking> {
        const original = await this.repository.getBookingDetailsItem(bookingId);
        if (!original) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        if (original.bookingStatus !== "PENDING") {
            return BookingsMapper.toDomain(original);
        }
        if (!original.holdId) {
            throw new BookingError("HOLD_NOT_FOUND", "Booking has no hold to consume", 409, "holdId");
        }
        try {
            await this.availability.consumeHold({
                holdId: original.holdId,
                bookingId,
            });
        } catch (error) {
            this.logger.error({
                event: "hold_consume_failed",
                bookingId,
                holdId: original.holdId,
                correlationId,
                code: error instanceof BookingError ? error.code : undefined,
            });
            if (this.isTerminalAllocationFailure(error)) {
                await this.repository.cancelBooking(original);
            }
            throw error;
        }
        const current = await this.repository.getBookingDetailsItem(bookingId);
        if (!current) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        await this.repository.updateBookingStatus("CREATED", current);
        const secured = await this.repository.getBookingById(bookingId);
        if (!secured) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        return secured;
    }

    private isTerminalAllocationFailure(error: unknown): boolean {
        return error instanceof BookingError && !error.retryable && (error.statusCode ?? 500) < 500;
    }

    private async cancelAndRelease(original: BookingDdbItem): Promise<void> {
        if (original.holdId) {
            await this.availability.releaseAllocation(original.id);
        }
        await this.repository.cancelBooking(original);
    }

    private validateStateTransition(currentStatus: string, targetStatus: string) {
        const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
        if (!allowedTransitions.includes(targetStatus)) {
            throw new BusinessRuleError(`Invalid booking status transition: ${currentStatus} -> ${targetStatus}`);
        }
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
        if (!['PENDING', 'CREATED'].includes(original.bookingStatus) || original.paymentStatus !== 'PENDING') {
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
        await this.repository.updateBookingStatus('CONFIRMED', original, 'PAID');
        const confirmed = await this.repository.getBookingById(bookingId);
        if (!confirmed) {
            throw new NotFoundError(`Booking with ID ${bookingId} not found`);
        }
        return confirmed;
    }

    private assertCustomerOwnsBooking(request: LambdaRequest, bookingCustomerId?: string): void {
        const customerId = requireCustomerId(request);
        if (!bookingCustomerId || bookingCustomerId !== customerId) {
            throw new ForbiddenError('Not authorized to access this booking');
        }
    }
}

let service: BookingsService;

export function getBookingsService() {
    if (!service) {
        service = new BookingsService();
    }
    return service;
}
