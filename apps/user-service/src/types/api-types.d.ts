export interface CreateUserRequest {
  userId: string;
  email: string;
  name: string;
}

export interface UpdateUserRequest {
  email?: string;
  name?: string;
}

export interface AssignUserToOrganizationRequest {
  userId: string;
  organizationId: string;
}

export interface UpdateUserMetadataRequest {
  metadata: Record<string, unknown>;
}

