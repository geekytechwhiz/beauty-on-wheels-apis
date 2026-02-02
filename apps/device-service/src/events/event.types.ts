/** Envelope for SNS notification events (published to user-service topic for shared consumer). */
export interface NotificationEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: string;
  correlationId?: string;
  data: T;
}

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
  doctorName?: string;
  devices?: Array<{ deviceId: string; category: string; name: string }>;
}
