/**
 * Read-only helper: get partner capability by partner id.
 * Caller (service) provides the getCapability function.
 */

import type { PartnerCapability } from '../models/capability.types';

export interface GetPartnerCapabilityReader {
  getCapability(partnerId: string): Promise<PartnerCapability | null>;
}

/**
 * Returns the capability for the given partner, or null if not set.
 */
export async function getPartnerCapability(
  partnerId: string,
  reader: GetPartnerCapabilityReader
): Promise<PartnerCapability | null> {
  return reader.getCapability(partnerId);
}
