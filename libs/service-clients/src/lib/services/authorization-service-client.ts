import { BaseClient } from "../client/base-service-client";
import {
  PermissionDTO,
  FeatureAccessCheckResponse,
  OrgFeaturesResponse,
} from "../types/dto";

export class AuthorizationServiceClient extends BaseClient {
  constructor() {
    const baseUrl = (process.env.AUTHORIZATION_SERVICE_URL || "").replace(
      /\/$/,
      ""
    );
    super(baseUrl, "authorization-service");
  }

  async getUserPermissions(
    organizationId: string,
    userId: string,
    authHeader?: string
  ): Promise<PermissionDTO[] | null> {
    return this.get<PermissionDTO[]>(
      `/organizations/${organizationId}/users/${userId}/permissions`,
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

