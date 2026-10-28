import { withApiHandler, createdResponse } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getReviewsService } from '../services/reviews.service';

export const handlePostReview = withApiHandler(
  {
    operation: 'postbookingreview',
    useLegacyResponseFormat: true,
  },
  async (request: LambdaRequest) => {
    const data = await getReviewsService().submit(request);
    return createdResponse(data, {
      title: 'REVIEW_SUBMITTED',
      description: 'Booking review submitted',
      severity: 'SUCCESS',
    }, {
      correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
    });
  },
);

export const handleGetReview = withApiHandler(
  { operation: 'getbookingreview' },
  async (request: LambdaRequest) => getReviewsService().get(request),
);
