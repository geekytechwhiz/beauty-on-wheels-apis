import { LambdaRequest } from '@api-hub/utils';

import { ReviewsService } from './reviews.service';

function reviewRequest(body: unknown, customerId = 'c1'): LambdaRequest {
  return {
    pathParameters: { bookingId: 'b1' },
    body,
    context: {
      authContext: { userId: customerId, roles: [], permissions: [], claims: {} },
      authHeader: 'Bearer token',
    },
    event: { headers: {} },
  } as unknown as LambdaRequest;
}

describe('ReviewsService', () => {
  const bookings = { getBookingById: jest.fn() };
  const reviews = {
    getReviewForBooking: jest.fn(),
    createReview: jest.fn(),
  };
  const service = new ReviewsService(reviews as never, bookings as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects reviews that are not for a completed booking owned by the caller', async () => {
    bookings.getBookingById.mockResolvedValue({
      id: 'b1',
      customerId: 'c1',
      vendorId: 'v1',
      bookingStatus: 'CONFIRMED',
    });

    await expect(service.submit(reviewRequest({ rating: 5 }))).rejects.toMatchObject({
      message: expect.stringMatching(/completed/i),
    });
  });

  it('persists a rating and optional comment once', async () => {
    bookings.getBookingById.mockResolvedValue({
      id: 'b1',
      customerId: 'c1',
      vendorId: 'v1',
      bookingStatus: 'COMPLETED',
    });
    reviews.getReviewForBooking.mockResolvedValue(null);
    reviews.createReview.mockImplementation(async (record: unknown) => record);

    const result = await service.submit(reviewRequest({ rating: 4, comment: 'Good wash' }));

    expect(result).toMatchObject({
      bookingId: 'b1',
      customerId: 'c1',
      vendorId: 'v1',
      rating: 4,
      comment: 'Good wash',
    });
    expect(result.reviewId).toBeTruthy();
    expect(result.submittedAt).toBeTruthy();
  });

  it('rejects duplicate reviews', async () => {
    bookings.getBookingById.mockResolvedValue({
      id: 'b1',
      customerId: 'c1',
      vendorId: 'v1',
      bookingStatus: 'COMPLETED',
    });
    reviews.getReviewForBooking.mockResolvedValue({
      reviewId: 'r1',
      bookingId: 'b1',
      customerId: 'c1',
      vendorId: 'v1',
      rating: 5,
      submittedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(service.submit(reviewRequest({ rating: 3 }))).rejects.toMatchObject({
      message: expect.stringMatching(/already exists/i),
    });
  });
});
