import { BaseClient } from "../client/base-service-client";
import { OrganizationDTO } from "../types/dto";

export class OrganizationServiceClient extends BaseClient {
  constructor() {
    const baseUrl = (process.env.ORGANIZATION_SERVICE_URL || "").replace(
      /\/$/,
      ""
    );
    super(baseUrl, "organization-service");
  }

  async getOrganization(
    organizationId: string,
    authHeader?: string
  ): Promise<OrganizationDTO | null> {
    return this.get<OrganizationDTO>(
      `/organizations/${organizationId}`,
      authHeader
    );
  }

  async validateOrganizationExists(
    organizationId: string,
    authHeader?: string
  ): Promise<boolean> {
    const org = await this.getOrganization(organizationId, authHeader);
    return org !== null && org.status === "ACTIVE";
  }
}

