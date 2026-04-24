export type { EventEnvelope } from '@api-hub/event-platform';

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
