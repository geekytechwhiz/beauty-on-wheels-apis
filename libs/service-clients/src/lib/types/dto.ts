export interface UserDTO {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
}

export interface OrganizationDTO {
  organizationId: string;
  name: string;
  type: string;
  status: string;
}

export interface RelationshipDTO {
  userId: string;
  memberId: string;
  relationType: string;
  emergencyContact: boolean;
  manageHealth: boolean;
}

export interface PermissionDTO {
  roleId: string;
  roleName: string;
  features: Array<{
    featureKey: string;
    featureName: string;
    functionalities: Array<{
      key: string;
      name: string;
      access: boolean;
    }>;
  }>;
}

export interface CreateExternalUserPayload {
  externalId: string;
  provider: string;
  tenantId: string;
  role: string;
  source: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}
export interface OrganizationUsersResponse {
  users: UserDTO[];
}

export interface BatchUsersResponse {
  users: UserDTO[];
}

export interface RelationshipsResponse {
  invitees: RelationshipDTO[];
  inviters: RelationshipDTO[];
}

export interface EmergencyContactsResponse {
  contacts: RelationshipDTO[];
}

export interface RelationshipCreatedResponse {
  success: boolean;
}

export interface FeatureAccessCheckResponse {
  allowed: boolean;
}

export interface OrgFeaturesResponse<TFeature = any> {
  features: TFeature[];
}

