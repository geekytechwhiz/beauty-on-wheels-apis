import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { UserCreatedNotificationRequestedData } from '../events/event.types';

const baseLogger = createLogger({ service: 'notification-service', redactPII: true });

function deriveChannelsFromPayload(payload: Partial<UserCreatedNotificationRequestedData>): string[] {
  const channels = new Set<string>();
  if (payload.channels && payload.channels.length > 0) {
    payload.channels.forEach(c => channels.add(String(c).toLowerCase()));
    return Array.from(channels);
  }

  // fallbacks
  if (payload.email) channels.add('email');
  if (payload.phone) channels.add('sms');
  if (payload.deviceToken || (payload as any).device) channels.add('push');

  return Array.from(channels);
}

export async function notifyUser(payload: {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  deviceToken?: string;
  device?: unknown;
  channels?: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  correlationId?: string;
  source?: string;
}): Promise<void> {
  const logger = createChildLogger(baseLogger, { correlationId: payload.correlationId, userId: payload.userId });

  const channels = deriveChannelsFromPayload({ ...payload, channels: payload.channels });

  const data: UserCreatedNotificationRequestedData = {
    userId: payload.userId,
    email: payload.email,
    phone: payload.phone,
    name: payload.name,
    channels,
    template: payload.template,
    templateData: payload.templateData,
  };

  try {
    await publishEvent(
      {
        eventId: randomUUID(),
        eventType: 'UserCreatedNotificationRequested',
        occurredAt: new Date().toISOString(),
        source: payload.source || 'user-service',
        correlationId: payload.correlationId,
        data,
      },
      payload.correlationId,
    );

    logger.info({ event: 'notify_user_event_published', channels, template: payload.template });
  } catch (err) {
    logger.error({ event: 'notify_user_publish_error', err: serializeError(err) });
  }
}
