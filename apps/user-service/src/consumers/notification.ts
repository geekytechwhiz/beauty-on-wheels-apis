import { createChildLogger, createLogger } from '@api-hub/observability';
import { Context, SNSEvent } from 'aws-lambda';
import type {
  PaymentStatusNotificationRequestedData,
  RecommendationNotificationRequestedData,
} from '../events/event.types';
import { UserRepository } from '../repositories/user.repository';
import { sendEmail, sendPush, sendSms } from '../services/notification.delivery';
import { NotificationPayload } from '../types/api-types';

const logger = createLogger({ service: 'notification-consumer', redactPII: true });
const userRepository = new UserRepository();



function normalizeChannels(channels: string[]): string[] {
  return (channels || []).map((c) => String(c).toLowerCase());
}

async function resolveContactForUserId(
  userId: string,
  organizationId?: string
): Promise<{ email?: string; phone?: string; deviceToken?: string }> {
  const user = await userRepository.getUser(userId, organizationId);
  if (!user) return {};
  const u = user as unknown as Record<string, unknown>;
  const email = (u.emailAddress as string) || (u.email as string);
  const pc = String(u.phoneCode ?? '').trim();
  const pn = String(u.phoneNumber ?? '').trim();
  const phone = pc ? (pc.startsWith('+') ? `${pc}${pn}` : `+${pc}${pn}`) : pn || undefined;
  const deviceToken = (u.deviceToken as string) || (u.device as string);
  return { email, phone, deviceToken };
}

async function deliver(payload: NotificationPayload): Promise<void> {
  const channels = normalizeChannels(payload.channels);
  logger.info({
    event: 'deliver_start',
    condition: 'entry',
    userId: payload.userId,
    channels,
    hasEmail: !!payload.email,
    hasPhone: !!payload.phone,
    hasDeviceToken: !!payload.deviceToken,
    message: `Delivering to ${channels.length} channel(s)`,
  });
  for (const ch of channels) {
    try {
      if (ch === 'email') {
        if (!payload.email) {
          logger.warn({
            event: 'skip_email_missing_address',
            condition: 'email_skipped',
            userId: payload.userId,
            message: 'Email channel in payload but no email address; skipping email',
          });
          continue;
        }
        logger.info({ event: 'deliver_email_sending', condition: 'email_send', userId: payload.userId });
        await sendEmail({ email: payload.email, template: payload.template, templateData: payload.templateData });
        logger.info({ event: 'deliver_email_done', condition: 'email_success', userId: payload.userId });
      } else if (ch === 'sms') {
        if (!payload.phone) {
          logger.warn({
            event: 'skip_sms_missing_number',
            condition: 'sms_skipped',
            userId: payload.userId,
            channels: payload.channels,
            message: 'SMS channel in payload but payload.phone is missing; SMS will not be sent',
          });
          continue;
        }
        logger.info({
          event: 'deliver_sms_sending',
          condition: 'sms_send',
          userId: payload.userId,
          hasPhone: true,
          template: payload.template,
          message: 'Calling sendSms',
        });
        await sendSms({ phone: payload.phone, template: payload.template, templateData: payload.templateData });
        logger.info({ event: 'deliver_sms_done', condition: 'sms_success', userId: payload.userId, message: 'sendSms completed' });
      } else if (ch === 'push') {
        logger.info({ event: 'deliver_push_sending', condition: 'push_send', userId: payload.userId });
        await sendPush({
          deviceToken: payload.deviceToken,
          template: payload.template,
          templateData: payload.templateData,
        });
        logger.info({ event: 'deliver_push_done', condition: 'push_success', userId: payload.userId });
      } else {
        logger.warn({ event: 'unknown_channel', condition: 'unknown_channel', channel: ch, userId: payload.userId });
      }
    } catch (deliveryErr) {
      logger.error({
        event: 'delivery_failed',
        condition: 'delivery_error',
        channel: ch,
        userId: payload.userId,
        err: serializeError(deliveryErr),
        message: `Delivery failed for channel ${ch}`,
      });
    }
  }
  logger.info({ event: 'deliver_complete', condition: 'exit', userId: payload.userId, channels, message: 'deliver() finished' });
}

export const handler = async (event: SNSEvent, _context: Context) => {
  logger.info({ event: 'notification_consumer_start', records: event.Records.length });

  for (const record of event.Records || []) {
    try {
      if (!record.Sns || !record.Sns.Message) continue;
      const envelope = JSON.parse(record.Sns.Message) as {
        eventType?: string;
        payload?: NotificationPayload & Record<string, unknown>;
        data?: NotificationPayload & Record<string, unknown>;
      };
      const data = (envelope.payload ?? envelope.data) as
        | (NotificationPayload & Record<string, unknown>)
        | undefined;
      if (!envelope?.eventType || !data) continue;

      const eventType = envelope.eventType;

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
        logger.info({
          event: 'UserCreatedNotificationRequested_received',
          condition: 'user_created_payload',
          userId: payload.userId,
          channels: payload.channels,
          hasPhone: !!payload.phone,
          hasEmail: !!payload.email,
          message: 'Parsed UserCreatedNotificationRequested; will call deliver()',
        });
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
