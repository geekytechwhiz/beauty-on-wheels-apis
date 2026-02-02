import { SNSEvent, Context } from 'aws-lambda';
import { createLogger, serializeError } from '@api-hub/logger';
import { sendEmail, sendSms, sendPush } from '../services/notification.delivery';
import type {
  UserCreatedNotificationRequestedData,
  DeviceErrorNotificationRequestedData,
  RecommendationNotificationRequestedData,
  PaymentStatusNotificationRequestedData,
} from '../events/event.types';
import { UserRepository } from '../repositories/user.repository';

const logger = createLogger({ service: 'notification-consumer', redactPII: true });
const userRepository = new UserRepository();

type NotificationPayload = {
  userId?: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  channels: string[];
  template?: string;
  templateData?: Record<string, unknown>;
};

function normalizeChannels(channels: string[]): string[] {
  return (channels || []).map((c) => String(c).toLowerCase());
}

async function resolveContactForUserId(
  userId: string,
  organizationId?: string
): Promise<{ email?: string; phone?: string; deviceToken?: string }> {
  const user = await userRepository.getUser(userId, organizationId);
  if (!user) return {};
  const u = user as Record<string, unknown>;
  const email = (u.emailAddress as string) || (u.email as string);
  const pc = String(u.phoneCode ?? '').trim();
  const pn = String(u.phoneNumber ?? '').trim();
  const phone = pc ? (pc.startsWith('+') ? `${pc}${pn}` : `+${pc}${pn}`) : pn || undefined;
  const deviceToken = (u.deviceToken as string) || (u.device as string);
  return { email, phone, deviceToken };
}

async function deliver(payload: NotificationPayload): Promise<void> {
  const channels = normalizeChannels(payload.channels);
  for (const ch of channels) {
    try {
      if (ch === 'email') {
        if (!payload.email) {
          logger.warn({ event: 'skip_email_missing_address', userId: payload.userId });
          continue;
        }
        await sendEmail({ email: payload.email, template: payload.template, templateData: payload.templateData });
      } else if (ch === 'sms') {
        if (!payload.phone) {
          logger.warn({ event: 'skip_sms_missing_number', userId: payload.userId });
          continue;
        }
        await sendSms({ phone: payload.phone, template: payload.template, templateData: payload.templateData });
      } else if (ch === 'push') {
        await sendPush({
          deviceToken: payload.deviceToken,
          template: payload.template,
          templateData: payload.templateData,
        });
      } else {
        logger.warn({ event: 'unknown_channel', channel: ch });
      }
    } catch (deliveryErr) {
      logger.error({ event: 'delivery_failed', channel: ch, err: serializeError(deliveryErr) });
    }
  }
}

export const handler = async (event: SNSEvent, _context: Context) => {
  logger.info({ event: 'notification_consumer_start', records: event.Records.length });

  for (const record of event.Records || []) {
    try {
      if (!record.Sns || !record.Sns.Message) continue;
      const envelope = JSON.parse(record.Sns.Message) as { eventType?: string; data?: NotificationPayload & Record<string, unknown> };
      if (!envelope?.eventType || !envelope.data) continue;

      const eventType = envelope.eventType;
      const data = envelope.data as NotificationPayload & Record<string, unknown>;

      let payload: NotificationPayload;
      if (eventType === 'UserCreatedNotificationRequested') {
        payload = {
          userId: data.userId,
          email: data.email as string | undefined,
          phone: data.phone as string | undefined,
          deviceToken: data.deviceToken as string | undefined,
          channels: data.channels || [],
          template: data.template as string | undefined,
          templateData: data.templateData as Record<string, unknown> | undefined,
        };
      } else if (eventType === 'DeviceErrorNotificationRequested') {
        payload = {
          userId: data.userId as string | undefined,
          email: data.email as string | undefined,
          phone: data.phone as string | undefined,
          deviceToken: data.deviceToken as string | undefined,
          channels: data.channels || ['email', 'sms', 'push'],
          template: (data.template as string) || 'DEVICE_ERROR',
          templateData: data.templateData as Record<string, unknown> | undefined,
        };
      } else if (eventType === 'RecommendationNotificationRequested') {
        const rec = data as unknown as RecommendationNotificationRequestedData;
        let email = rec.email;
        let phone = rec.phone;
        let deviceToken = rec.deviceToken;
        if ((!email && !phone) && rec.userId) {
          const contact = await resolveContactForUserId(rec.userId, rec.organizationId);
          email = contact.email ?? email;
          phone = contact.phone ?? phone;
          deviceToken = contact.deviceToken ?? deviceToken;
        }
        payload = {
          userId: rec.userId,
          email,
          phone,
          deviceToken,
          channels: rec.channels?.length ? rec.channels : ['email', 'sms', 'push'],
          template: rec.template || 'RECOMMENDATION_ADDED',
          templateData: rec.templateData,
        };
      } else if (eventType === 'PaymentStatusNotificationRequested') {
        const pay = data as unknown as PaymentStatusNotificationRequestedData;
        let email = pay.email;
        let phone = pay.phone;
        let deviceToken = pay.deviceToken;
        if ((!email && !phone) && pay.userId) {
          const contact = await resolveContactForUserId(pay.userId, pay.organizationId);
          email = contact.email ?? email;
          phone = contact.phone ?? phone;
          deviceToken = contact.deviceToken ?? deviceToken;
        }
        payload = {
          userId: pay.userId,
          email,
          phone,
          deviceToken,
          channels: pay.channels?.length ? pay.channels : ['email', 'sms', 'push'],
          template: pay.template || 'PAYMENT_STATUS',
          templateData: pay.templateData,
        };
      } else {
        logger.debug({ event: 'notification_unknown_type', eventType });
        continue;
      }

      await deliver(payload);
    } catch (err) {
      logger.error({ event: 'notification_record_error', err: serializeError(err) });
    }
  }

  logger.info({ event: 'notification_consumer_done' });
  return { success: true };
};
