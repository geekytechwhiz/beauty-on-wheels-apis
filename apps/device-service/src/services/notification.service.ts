import { createLogger, createChildLogger } from '@api-hub/observability';
import { publishNotificationEvent } from '../events/notification-sns.publisher';
import type {
  DeviceErrorNotificationRequestedData,
  RecommendationNotificationRequestedData,
} from '../events/event.types';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });

/**
 * Publish device error notification – Email/SMS/push via error_notification API.
 * Consumer (user-service) delivers to channels.
 */
export async function publishDeviceErrorNotification(payload: {
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  name?: string;
  channels?: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  deviceId?: string;
  errorCode?: string;
  correlationId?: string;
}): Promise<void> {
  const logger = createChildLogger(baseLogger, {
    correlationId: payload.correlationId,
    deviceId: payload.deviceId,
  });
  const channels = payload.channels?.length
    ? payload.channels
    : ['email', 'sms', 'push'].filter((_, i) => [payload.email, payload.phone, payload.deviceToken][i]);
  const data: DeviceErrorNotificationRequestedData = {
    userId: payload.userId,
    email: payload.email,
    phone: payload.phone,
    deviceToken: payload.deviceToken,
    name: payload.name,
    channels,
    template: payload.template || 'DEVICE_ERROR',
    templateData: payload.templateData,
    deviceId: payload.deviceId,
    errorCode: payload.errorCode,
  };
  await publishNotificationEvent('DeviceErrorNotificationRequested', data, payload.correlationId);
  logger.info({ event: 'device_error_notification_published', channels });
}

/**
 * Publish recommendation notification – Push + SMS + email to patient.
 * Consumer resolves contact from userId + organizationId if not provided.
 */
export async function publishRecommendationNotification(payload: {
  userId: string;
  organizationId?: string;
  doctorName?: string;
  devices?: Array<{ deviceId: string; category: string; name: string }>;
  correlationId?: string;
}): Promise<void> {
  const logger = createChildLogger(baseLogger, {
    correlationId: payload.correlationId,
    userId: payload.userId,
  });
  const data: RecommendationNotificationRequestedData = {
    userId: payload.userId,
    organizationId: payload.organizationId,
    channels: ['email', 'sms', 'push'],
    template: 'RECOMMENDATION_ADDED',
    templateData: {
      doctorName: payload.doctorName,
      devices: payload.devices,
      deviceCount: payload.devices?.length ?? 0,
    },
    doctorName: payload.doctorName,
    devices: payload.devices,
  };
  await publishNotificationEvent('RecommendationNotificationRequested', data, payload.correlationId);
  logger.info({ event: 'recommendation_notification_published' });
}
