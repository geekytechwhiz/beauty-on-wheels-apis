export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: string;
  correlationId?: string;
  idempotencyKey?: string;
  data: T;
}

export interface UserCreatedNotificationRequestedData {
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  name?: string;
  channels: string[];
  template?: string; // e.g. 'WELCOME', 'PASSWORD_RESET'
  templateData?: Record<string, unknown>;
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

