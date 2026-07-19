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
    ConditionalWriteConflictError
} from "@api-hub/utils";
import { Booking } from "../types/api-types";

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
        private readonly repository: BookingsRepository =
            getBookingsRepository()
    ) {}

    async getbookings(filters: {
        customerId?: string;
        vendorId?: string;
        correlationId?: string;
    }) {
        const correlationId = filters.correlationId || "unknown";
        const customerId = filters.customerId;
        const vendorId = filters.vendorId;

        this.logger.info({
            event: "getbookings_start",
            customerId,
            vendorId,
            correlationId
        });

        try {
            let bookings: Booking[];
            if (customerId) {
                bookings = await this.repository.getCustomerBookings(customerId);
            } else if (vendorId) {
                bookings = await this.repository.getVendorBookings(vendorId);
            } else {
                bookings = await this.repository.listAllBookings();
            }

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
        this.logger.info({
            event: "postbookings_start",
            body: request.body,
            correlationId
        });

        const body = request.body as Booking;

        // Validation
        if (!body.customerId) {
            throw new ValidationError("customerId is required");
        }
        if (!body.vendorId) {
            throw new ValidationError("vendorId is required");
        }
        if (!body.bookingDate) {
            throw new ValidationError("bookingDate is required");
        }
        if (!body.slotId) {
            throw new ValidationError("slotId is required");
        }
        if (!body.serviceIds || body.serviceIds.length === 0) {
            throw new ValidationError("At least one serviceId is required");
        }
        if (body.totalAmount === undefined || body.totalAmount < 0) {
            throw new ValidationError("totalAmount must be a non-negative number");
        }

        const id = body.id || randomUUID();
        const newBooking: Booking = {
            ...body,
            id,
            bookingStatus: 'CREATED',
            paymentStatus: 'PENDING'
        };

        try {
            const created = await this.repository.createBooking(newBooking);

            this.logger.info({
                event: "postbookings_success",
                bookingId: id,
                correlationId
            });

            return created;
        } catch (error: any) {
            this.logger.error({
                event: "postbookings_failed",
                error: error.message,
                correlationId
            });

            if (error instanceof ConditionalWriteConflictError) {
                throw new ConflictError("The selected slot is already booked for this vendor on this date/time.");
            }
            throw error;
        }
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

        // Check if cancellable
        const allowedToCancel = ['CREATED', 'CONFIRMED', 'PENDING'];
        if (!allowedToCancel.includes(original.bookingStatus)) {
            throw new BusinessRuleError(`Cannot cancel booking in ${original.bookingStatus} state`);
        }

        try {
            await this.repository.cancelBooking(original);

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

    async postconfirm(request: LambdaRequest) {
        return this.transitionStatus(request, 'CONFIRMED');
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

        // Validate transition
        this.validateStateTransition(original.bookingStatus, 'CANCELLED');

        try {
            await this.repository.cancelBooking(original);

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

    private validateStateTransition(currentStatus: string, targetStatus: string) {
        const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
        if (!allowedTransitions.includes(targetStatus)) {
            throw new BusinessRuleError(`Invalid booking status transition: ${currentStatus} -> ${targetStatus}`);
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
