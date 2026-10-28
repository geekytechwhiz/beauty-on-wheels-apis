import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getBookingChangesService } from '../services/booking-changes.service';

export const handlePostBookingChangePreview = withApiHandler(
  { operation: 'postbookingchangepreview' },
  async (request: LambdaRequest) => getBookingChangesService().preview(request),
);

export const handlePostBookingChange = withApiHandler(
  { operation: 'postbookingchange' },
  async (request: LambdaRequest) => getBookingChangesService().commit(request),
);
