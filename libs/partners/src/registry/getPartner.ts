/**
 * Read-only helper: get partner by id.
 * Caller (service) provides the getById function (e.g. from repository).
 */

import type { Partner } from '../models/partner.types';

export interface GetPartnerReader {
  getById(partnerId: string): Promise<Partner | null>;
}

/**
 * Returns the partner for the given id, or null if not found.
 */
export async function getPartner(
  partnerId: string,
  reader: GetPartnerReader
): Promise<Partner | null> {
  return reader.getById(partnerId);
}
