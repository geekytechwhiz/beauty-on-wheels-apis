import { BaseClient } from "../client/base-service-client";
import {
  PermissionDTO,
  FeatureAccessCheckResponse,
  OrgFeaturesResponse,
} from "../types/dto";

export class RoleServiceClient extends BaseClient {
  constructor() {
    const baseUrl = (process.env.ROLE_SERVICE_URL || "").replace(
      /\/$/,
      ""
    );
    super(baseUrl, "role-service");
  }

  async getRoleDetails(
    userRole: string | string[],
    organizationId: string,
    authHeader?: string
  ): Promise<PermissionDTO[] | null> {
    
    const roleIds = Array.isArray(userRole)
    ? userRole.map((roleId: string) => String(roleId))
    : userRole
      ? [String(userRole)]
      : [];
    return this.get<PermissionDTO[]>(
      `/organizations/${organizationId}/roles/${roleIds}/details`,
      authHeader
    );
  }

  async checkFeatureAccess(
    organizationId: string,
    featureKey: string,
    authHeader?: string
  ): Promise<boolean> {
    const response = await this.get<FeatureAccessCheckResponse>(
      `/organizations/${organizationId}/features/${featureKey}/check`,
      authHeader
    );

    return response?.allowed ?? false;
  }

  async getOrgFeatures<TFeature = any>(
    organizationId: string,
    authHeader?: string
  ): Promise<TFeature[] | null> {
    const response = await this.get<OrgFeaturesResponse<TFeature>>(
      `/organizations/${organizationId}/features`,
      authHeader
    );

    return response?.features ?? null;
  }
}

