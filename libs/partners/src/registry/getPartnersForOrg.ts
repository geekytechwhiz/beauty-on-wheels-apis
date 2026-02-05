/**
 * Read-only helper: list partners linked to an organization.
 * Caller (service) provides the listByOrg function.
 */

import type { Partner } from '../models/partner.types';

export interface OrgPartnerLink {
  partnerId: string;
  organizationId: string;
  linkedAt: string;
  /** Optional relationship type */
  relationshipType?: string;
}

export interface GetPartnersForOrgReader {
  listPartnersForOrg(organizationId: string): Promise<OrgPartnerLink[]>;
  getById(partnerId: string): Promise<Partner | null>;
}

/**
 * Returns partners linked to the given organization.
 * Fetches full partner details for each link.
 */
export async function getPartnersForOrg(
  organizationId: string,
  reader: GetPartnersForOrgReader
): Promise<Partner[]> {
  const links = await reader.listPartnersForOrg(organizationId);
  const partners: Partner[] = [];
  for (const link of links) {
    const partner = await reader.getById(link.partnerId);
    if (partner) partners.push(partner);
  }
  return partners;
}
