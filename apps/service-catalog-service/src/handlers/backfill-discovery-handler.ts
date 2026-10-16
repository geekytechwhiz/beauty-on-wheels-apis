import { getServicesRepository } from '../repositories/services.repository';
import { backfillDiscoveryProjections } from '../discovery/backfill-discovery-projections';
import { getDiscoveryFactsSource } from '../integrations/vendor-discovery-facts';

/**
 * Manual invoke only. There is no schedule and no HTTP route.
 * Pass `{ vendorId, dryRun }`. dryRun must be an explicit boolean.
 */
export async function handler(event: unknown): Promise<unknown> {
  const body = typeof event === 'object' && event !== null
    ? event as Record<string, unknown>
    : {};
  const vendorId = typeof body.vendorId === 'string' ? body.vendorId.trim() : '';
  if (!vendorId) {
    throw new Error('vendorId is required');
  }
  if (typeof body.dryRun !== 'boolean') {
    throw new Error('dryRun boolean is required');
  }

  return backfillDiscoveryProjections(getServicesRepository(), {
    vendorId,
    dryRun: body.dryRun,
  }, getDiscoveryFactsSource());
}
