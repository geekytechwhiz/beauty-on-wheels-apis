import { SNSEvent, Context } from 'aws-lambda';
import { createLogger, serializeError } from '@api-hub/logger';
import { sendEmail, sendSms, sendPush } from '../services/notification.delivery';
import type { UserCreatedNotificationRequestedData } from '../events/event.types';

const logger = createLogger({ service: 'notification-consumer', redactPII: true });

export const handler = async (event: SNSEvent, _context: Context) => {
  logger.info({ event: 'notification_consumer_start', records: event.Records.length });

  for (const record of event.Records || []) {
    try {
      if (!record.Sns || !record.Sns.Message) continue;
      const envelope = JSON.parse(record.Sns.Message) as { eventType?: string; data?: UserCreatedNotificationRequestedData };
      if (!envelope || envelope.eventType !== 'UserCreatedNotificationRequested' || !envelope.data) continue;

      const data = envelope.data;
      const channels = (data.channels || []).map(c => String(c).toLowerCase());

      for (const ch of channels) {
        try {
          if (ch === 'email') {
            await sendEmail({ email: data.email, template: data.template, templateData: data.templateData });
          } else if (ch === 'sms') {
            await sendSms({ phone: data.phone, template: data.template, templateData: data.templateData });
          } else if (ch === 'push') {
            await sendPush({ deviceToken: (data as any).deviceToken, template: data.template, templateData: data.templateData });
          } else {
            logger.warn({ event: 'unknown_channel', channel: ch });
          }
        } catch (deliveryErr) {
          logger.error({ event: 'delivery_failed', channel: ch, err: serializeError(deliveryErr) });
          // Do not throw here to allow other channels to run; consider DLQ or retry upstream
        }
      }
    } catch (err) {
      logger.error({ event: 'notification_record_error', err: serializeError(err) });
      // continue processing other records
    }
  }

  logger.info({ event: 'notification_consumer_done' });
  return { success: true };
};
