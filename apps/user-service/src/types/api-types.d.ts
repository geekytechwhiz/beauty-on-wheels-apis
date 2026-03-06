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


export type NotificationPayload = {
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  channels: string[];
  template?: string;
  templateData?: Record<string, unknown>;
};