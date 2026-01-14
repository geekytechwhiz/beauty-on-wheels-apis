export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: string;
  correlationId?: string;
  idempotencyKey?: string;
  data: T;
}

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

export interface OrganizationDeviceAssignedData {
  organizationId: string;
  deviceId: string;
  assignedAt: string;
}

export interface OrganizationDeviceRemovedData {
  organizationId: string;
  deviceId: string;
  removedAt: string;
}

export interface OrganizationMetadataUpdatedData {
  organizationId: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface OrganizationFileUploadedData {
  organizationId: string;
  fileId: string;
  fileName: string;
  s3Key: string;
  uploadedAt: string;
}
