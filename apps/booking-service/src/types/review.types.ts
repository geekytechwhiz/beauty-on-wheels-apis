export interface BookingReviewRecord {
  reviewId: string;
  bookingId: string;
  customerId: string;
  vendorId: string;
  rating: number;
  comment?: string;
  submittedAt: string;
}

export interface BookingReviewDdbItem extends BookingReviewRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'BookingReview';
}
