import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest, ValidationError } from '@api-hub/utils';
import { getBookingReadinessService } from '../services/booking-readiness.service';

export const handleGetBookingReadiness = withApiHandler({ operation: 'getVendorBookingReadiness' }, async (request: LambdaRequest) => {
  const vendorId = request.pathParameters?.vendorId;
  if (!vendorId) throw new ValidationError('vendorId is required');
  return getBookingReadinessService().get(request, vendorId);
});
