import { getBookingReadinessService } from '../services/booking-readiness.service';
/** Operations-only direct invoke; page size bounds reconciliation work. */
export const handler = async (event: { cursor?: Record<string, unknown>; limit?: unknown } | null) => {
  const limit = typeof event?.limit === 'number' && Number.isInteger(event.limit) && event.limit > 0 && event.limit <= 100 ? event.limit : 25;
  return getBookingReadinessService().backfill(event?.cursor, limit);
};
