export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: string;
  correlationId?: string;
  idempotencyKey?: string;
  data: T;
}

export interface UserCreatedData {
  userId: string;
  email: string;
  name: string;
}

export interface UserProfileUpdatedData {
  userId: string;
  email?: string;
  name?: string;
}

export interface UserDeletedData {
  userId: string;
}

export interface UserFileUploadedData {
  userId: string;
  fileId: string;
  fileName: string;
  s3Key: string;
}

