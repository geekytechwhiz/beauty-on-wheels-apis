import { publishCatalogBookingReadiness } from '../events/publish-booking-readiness';

/** Reconciliation entry point. Commits and publishes the catalog service summary. */
export const getBookingReadinessFacts = async (event: { vendorId?: unknown; correlationId?: unknown } | null): Promise<unknown> => {
  const vendorId = typeof event?.vendorId === 'string' ? event.vendorId.trim() : '';
  if (!vendorId) return { error: { code: 'VALIDATION_ERROR', message: 'vendorId is required', statusCode: 400 } };
  const correlationId = typeof event?.correlationId === 'string' && event.correlationId.trim()
    ? event.correlationId.trim()
    : `catalog-readiness-${vendorId}`;
  return { data: await publishCatalogBookingReadiness({ vendorId, correlationId }) };
};
