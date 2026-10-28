import { randomUUID } from 'crypto';

import {
  BusinessRuleError,
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { requireCustomerId } from '../auth/access';
import {
  getBookingsRepository,
  BookingsRepository,
} from '../repositories/bookings.repository';
import {
  getReviewsRepository,
  ReviewsRepository,
} from '../repositories/reviews.repository';
import { BookingReviewRecord } from '../types/review.types';

const baseLogger = createLogger({ service: 'reviews-service', redactPII: true });

export class ReviewsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'ReviewsService' });

  constructor(
    private readonly reviews: ReviewsRepository = getReviewsRepository(),
    private readonly bookings: BookingsRepository = getBookingsRepository(),
  ) {}

  async submit(request: LambdaRequest): Promise<BookingReviewRecord> {
    const customerId = requireCustomerId(request);
    const bookingId = pathId(request, 'bookingId');
    const body = (request.body ?? {}) as { rating?: unknown; comment?: unknown };
    const rating = typeof body.rating === 'number' ? body.rating : Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('rating must be an integer from 1 to 5');
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim() : undefined;
    if (comment && comment.length > 2000) {
      throw new ValidationError('comment must be at most 2000 characters');
    }

    const booking = await this.bookings.getBookingById(bookingId);
    if (!booking) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
    if (booking.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to review this booking');
    }
    if (booking.bookingStatus !== 'COMPLETED') {
      throw new BusinessRuleError('Reviews can only be submitted for completed bookings');
    }

    const existing = await this.reviews.getReviewForBooking(bookingId);
    if (existing) {
      throw new ConflictError('A review already exists for this booking');
    }

    const record: BookingReviewRecord = {
      reviewId: randomUUID(),
      bookingId,
      customerId,
      vendorId: booking.vendorId!,
      rating,
      ...(comment ? { comment } : {}),
      submittedAt: new Date().toISOString(),
    };

    try {
      await this.reviews.createReview(record);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('A review already exists for this booking');
      }
      throw error;
    }

    this.logger.info({ event: 'review_submitted', bookingId, reviewId: record.reviewId, rating });
    return record;
  }

  async get(request: LambdaRequest): Promise<BookingReviewRecord> {
    const customerId = requireCustomerId(request);
    const bookingId = pathId(request, 'bookingId');
    const booking = await this.bookings.getBookingById(bookingId);
    if (!booking) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
    if (booking.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to view this review');
    }
    const review = await this.reviews.getReviewForBooking(bookingId);
    if (!review) throw new NotFoundError('Review not found for this booking');
    return review;
  }
}

function pathId(request: LambdaRequest, key: string) {
  const value = request.pathParameters?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${key} is required`);
  }
  return value.trim();
}

let service: ReviewsService;

export function getReviewsService() {
  if (!service) service = new ReviewsService();
  return service;
}
