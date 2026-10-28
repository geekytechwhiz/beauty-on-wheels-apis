import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { BookingReviewDdbItem, BookingReviewRecord } from '../types/review.types';

export class ReviewsRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getReviewForBooking(bookingId: string): Promise<BookingReviewRecord | null> {
    const item = await this.get<BookingReviewDdbItem>(this.getTableName(), {
      PK: `BOOKING#${bookingId}`,
      SK: 'REVIEW',
    });
    return item ? toRecord(item) : null;
  }

  async createReview(record: BookingReviewRecord): Promise<BookingReviewRecord> {
    const item: BookingReviewDdbItem = {
      PK: `BOOKING#${record.bookingId}`,
      SK: 'REVIEW',
      GSI1PK: `VENDOR#${record.vendorId}`,
      GSI1SK: `REVIEW#${record.submittedAt}#${record.reviewId}`,
      entityType: 'BookingReview',
      ...record,
    };
    await this.put(this.getTableName(), item, 'attribute_not_exists(PK)');
    return record;
  }
}

function toRecord(item: BookingReviewDdbItem): BookingReviewRecord {
  return {
    reviewId: item.reviewId,
    bookingId: item.bookingId,
    customerId: item.customerId,
    vendorId: item.vendorId,
    rating: item.rating,
    comment: item.comment,
    submittedAt: item.submittedAt,
  };
}

let repository: ReviewsRepository;

export function getReviewsRepository() {
  if (!repository) repository = new ReviewsRepository();
  return repository;
}
