import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { createLogger, createChildLogger, serializeError } from '@api-hub/observability';
import type { OrganizationActivatedNotificationRequestedData } from '../events/event.types';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

function deriveChannels(payload: {
  email?: string;
  phone?: string;
  channels?: string[];
}): string[] {
  const channels = new Set<string>();
  if (payload.channels && payload.channels.length > 0) {
    payload.channels.forEach((c) => channels.add(String(c).toLowerCase()));
    if (!payload.email) channels.delete('email');
    if (!payload.phone) channels.delete('sms');
    return Array.from(channels);
  }
  if (payload.email) channels.add('email');
  if (payload.phone) channels.add('sms');
  return Array.from(channels);
}

/**
 * Publishes OrganizationActivatedNotificationRequested so a downstream consumer can send email + SMS to the org admin.
 * Mirrors user-service notifyUser pattern (event-driven notification).
 */
export async function notifyAdminForOrganizationActivated(payload: {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  channels?: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  organizationId: string;
  organizationName?: string;
  correlationId?: string;
}): Promise<void> {
  const logger = createChildLogger(baseLogger, {
    correlationId: payload.correlationId,
    organizationId: payload.organizationId,
    userId: payload.userId,
  });

  const channels = deriveChannels({
    email: payload.email,
    phone: payload.phone,
    channels: payload.channels,
  });

  if (channels.length === 0) {
    logger.info({ event: 'notify_admin_skipped_no_channels', message: 'No email or phone for admin' });
    return;
  }

  const data: OrganizationActivatedNotificationRequestedData = {
    userId: payload.userId,
    email: payload.email,
    phone: payload.phone,
    name: payload.name,
    channels,
    template: payload.template ?? 'ORGANIZATION_ACTIVATED',
    templateData: payload.templateData,
    organizationId: payload.organizationId,
    organizationName: payload.organizationName,
  };

  try {
    const eventId = randomUUID();
    await publishEvent(
      {
        eventId,
        eventType: 'OrganizationActivatedNotificationRequested',
        timestamp: new Date().toISOString(),
        source: 'organization-service', 
        idempotencyKey: eventId,
        payload: data,
        meta: {
          correlationId: payload.correlationId ?? randomUUID(),
          publishedAt: new Date().toISOString(),
          retryCount: 0,
        },
        eventVersion: '1.0.0',
      },
      payload.correlationId ?? randomUUID(),
    );
    logger.info({ event: 'notify_admin_organization_activated_published', channels, template: data.template });
  } catch (err) {
    logger.error({ event: 'notify_admin_publish_error', err: serializeError(err) });
    throw err;
  }
}
