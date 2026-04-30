export type { EventEnvelope } from '@api-hub/event-platform';

export interface OrganizationCreatedData {
  organizationId: string;
  name: string;
  email?: string;
  status: string;
  createdDate: number;
}

export interface OrganizationUpdatedData {
  organizationId: string;
  updatedFields: Record<string, unknown>;
  modifiedDate: number;
}

export interface OrganizationDeletedData {
  organizationId: string;
  deletedAt: number;
}

export interface OrganizationUserAssignedData {
  organizationId: string;
  userId: string;
  assignedAt: string;
  role?: string;
}

export interface OrganizationUserRemovedData {
  organizationId: string;
  userId: string;
  removedAt: string;
}

export interface OrganizationMetadataUpdatedData {
  organizationId: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
  updatedBy?: string;
  version?: number;
}

export interface OrganizationFileUploadedData {
  organizationId: string;
  fileId: string;
  fileName: string;
  s3Key: string;
  uploadedAt: string;
  fileSize?: number;
  contentType?: string;
  uploadedBy?: string;
  description?: string;
  tags?: string[];
}

/** Payload for admin notification when org status becomes ACTIVE (email + SMS). Same shape as user-service notification for shared consumer. */
export interface OrganizationActivatedNotificationRequestedData {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  channels: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  organizationId: string;
  organizationName?: string;
}
