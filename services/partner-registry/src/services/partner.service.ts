import { ulid } from 'ulid';
import type { Partner, PartnerCapability } from '@api-hub/partners';
import { PartnerRepository } from '../repositories/partner.repository';
import { PartnerNotFoundError } from '../utils/errors';
import type { CreatePartnerInput, UpdatePartnerInput } from '../models/partner.model';
import type { SetCapabilityInput } from '../models/capability.model';

export class PartnerService {
  constructor(private readonly repository: PartnerRepository) {}

  async createPartner(input: CreatePartnerInput): Promise<Partner> {
    const partnerId = ulid();
    return this.repository.createPartner(partnerId, input);
  }

  async getPartner(partnerId: string): Promise<Partner | null> {
    return this.repository.getPartner(partnerId);
  }

  async getPartnerOrThrow(partnerId: string): Promise<Partner> {
    const partner = await this.repository.getPartner(partnerId);
    if (!partner) throw new PartnerNotFoundError(partnerId);
    return partner;
  }

  async updatePartner(partnerId: string, input: UpdatePartnerInput): Promise<Partner | null> {
    return this.repository.updatePartner(partnerId, input);
  }

  async setCapability(partnerId: string, input: SetCapabilityInput): Promise<PartnerCapability> {
    await this.getPartnerOrThrow(partnerId);
    return this.repository.setCapability(partnerId, input);
  }

  async getCapability(partnerId: string): Promise<PartnerCapability | null> {
    return this.repository.getCapability(partnerId);
  }

  async linkOrgPartner(
    organizationId: string,
    partnerId: string,
    relationshipType?: string
  ): Promise<void> {
    await this.getPartnerOrThrow(partnerId);
    return this.repository.linkOrgPartner(organizationId, partnerId, relationshipType);
  }

  async listPartnersForOrg(
    organizationId: string
  ): Promise<{ partnerId: string; organizationId: string; linkedAt: string; relationshipType?: string }[]> {
    return this.repository.listPartnersForOrg(organizationId);
  }

  /** Returns full partner records for an organization. */
  async listPartnersForOrgFull(organizationId: string): Promise<Partner[]> {
    const links = await this.repository.listPartnersForOrg(organizationId);
    const partners: Partner[] = [];
    for (const link of links) {
      const partner = await this.repository.getPartner(link.partnerId);
      if (partner) partners.push(partner);
    }
    return partners;
  }

  async approvePartner(partnerId: string, approvedBy?: string): Promise<Partner | null> {
    await this.getPartnerOrThrow(partnerId);
    return this.repository.approvePartner(partnerId, approvedBy);
  }

  async rejectPartner(partnerId: string, rejectionReason: string): Promise<Partner | null> {
    await this.getPartnerOrThrow(partnerId);
    return this.repository.rejectPartner(partnerId, rejectionReason);
  }
}
