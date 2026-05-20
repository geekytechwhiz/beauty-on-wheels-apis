import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { createLogger, createChildLogger, serializeError } from '@api-hub/observability';
import type { UserCreatedNotificationRequestedData } from '../events/event.types';

const baseLogger = createLogger({ service: 'notification-service', redactPII: true });

function deriveChannelsFromPayload(
  payload: Partial<UserCreatedNotificationRequestedData>,
  logger: ReturnType<typeof createChildLogger>,
): string[] {
  const channels = new Set<string>();
  if (payload.channels && payload.channels.length > 0) {
    payload.channels.forEach(c => channels.add(String(c).toLowerCase()));
    const beforeDelete = Array.from(channels);
    if (!payload.email) {
      channels.delete('email');
      logger.info({ event: 'deriveChannels_removed_email', condition: 'no_email', before: beforeDelete, after: Array.from(channels) });
    }
    if (!payload.phone) {
      channels.delete('sms');
      logger.info({ event: 'deriveChannels_removed_sms', condition: 'no_phone', before: beforeDelete, after: Array.from(channels), message: 'SMS removed from channels because payload.phone is missing' });
    }
    logger.info({ event: 'deriveChannels_from_payload', condition: 'had_channels', inputChannels: payload.channels, derivedChannels: Array.from(channels), hasPhone: !!payload.phone, hasEmail: !!payload.email });
    return Array.from(channels);
  }

  // fallbacks
  if (payload.email) channels.add('email');
  if (payload.phone) channels.add('sms');
  if (payload.deviceToken || (payload as any).device) channels.add('push');
  logger.info({ event: 'deriveChannels_fallback', condition: 'no_channels_input', derivedChannels: Array.from(channels), hasPhone: !!payload.phone, hasEmail: !!payload.email });
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

  logger.info({
    event: 'notifyUser_received',
    condition: 'entry',
    hasPhone: !!payload.phone,
    hasEmail: !!payload.email,
    inputChannels: payload.channels,
    template: payload.template,
    message: 'notifyUser called; deriving channels',
  });

  const channels = deriveChannelsFromPayload({ ...payload, channels: payload.channels }, logger);

  const data: UserCreatedNotificationRequestedData = {
    userId: payload.userId,
    email: payload.email,
    phone: payload.phone,
    name: payload.name,
    channels,
    template: payload.template,
    templateData: payload.templateData,
  };

  logger.info({
    event: 'notifyUser_publish_attempt',
    condition: 'before_publish',
    channels: data.channels,
    hasPhone: !!data.phone,
    hasEmail: !!data.email,
    eventType: 'UserCreatedNotificationRequested',
    message: 'Publishing to SNS',
  });

  try {
    const eventId = randomUUID();
    await publishEvent(
      {
        eventId,
        eventType: 'UserCreatedNotificationRequested',
        timestamp: new Date().toISOString(),
        eventVersion: '1.0.0',
        source: payload.source || 'user-service',
        idempotencyKey: eventId,
        payload: data,
        meta: {
          correlationId: payload.correlationId ?? randomUUID(),
          publishedAt: new Date().toISOString(),
          retryCount: 0,
        },
      },
      payload.correlationId ?? randomUUID(),
    );

    logger.info({
      event: 'notify_user_event_published',
      condition: 'publish_success',
      channels: data.channels,
      template: payload.template,
      smsInChannels: data.channels.includes('sms'),
      message: 'Event published successfully',
    });
  } catch (err) {
    logger.error({
      event: 'notify_user_publish_error',
      condition: 'publish_failed',
      err: serializeError(err),
      channels: data.channels,
      message: 'publishEvent threw; check USER_EVENTS_TOPIC_ARN and SNS permissions',
    });
  }
}
