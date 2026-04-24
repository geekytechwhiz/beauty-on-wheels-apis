export type { EventEnvelope } from '@api-hub/event-platform';

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

/** Device error notification – Email/SMS/push via error_notification API. Same envelope shape for consumer. */
export interface DeviceErrorNotificationRequestedData {
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  name?: string;
  channels: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  deviceId?: string;
  errorCode?: string;
}

/** Recommend services – Push + SMS + email to patient. Consumer may resolve contact from userId + organizationId. */
export interface RecommendationNotificationRequestedData {
  userId: string;
  organizationId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  name?: string;
  channels: string[];
  template?: string;
  templateData?: Record<string, unknown>;
}

/** Payment status (completed/cancelled/refunded/refund_initiated) – Push + SMS + email. */
export interface PaymentStatusNotificationRequestedData {
  userId: string;
  organizationId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  name?: string;
  channels: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  orderId?: string;
  status?: string;
}

