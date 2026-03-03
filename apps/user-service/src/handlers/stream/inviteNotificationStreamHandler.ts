import { DynamoDBStreamEvent } from 'aws-lambda';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import axios from 'axios';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const SEND_EMAIL_API_URL = process.env.SEND_EMAIL_API_URL || '';
const SMS_API_URL = process.env.SMS_API_URL || '';

interface InviteDetails {
  email?: boolean;
  emailUpdatedAt?: string;
  sms?: boolean;
  smsUpdatedAt?: string;
}

async function processRecord(
  record: DynamoDBStreamEvent['Records'][number],
  correlationId: string,
): Promise<void> {
  const sequenceNumber = record.dynamodb?.SequenceNumber;
  const logger = createChildLogger(baseLogger, { correlationId, sequenceNumber });

  // Only care about MODIFY events (updateRecentInvite always does an UpdateItem)
  if (record.eventName !== 'MODIFY') {
    logger.info({
      event: 'inviteNotificationStream_skipped',
      eventName: record.eventName,
      message: 'Not a MODIFY event, skipping',
    });
    return;
  }

   const oldItem = record?.dynamodb?.OldImage
    ? unmarshall(record?.dynamodb?.OldImage as Record<string, any>)
    : {};
    
  console.log("OLD ITEM",oldItem)
  const oldInviteDetails = oldItem.inviteDetails as InviteDetails | undefined;
  console.log("OLD INVITE DETAILS",oldInviteDetails)

  const userId = (oldItem.userID || oldItem.userId || '') as string;
  const emailAddress = (oldItem.emailAddress || '') as string;
  const phoneNumber = (oldItem.phoneNumber || '') as string;
  const fullName = (oldItem.fullName || '') as string;
  const organizationID = (oldItem.organizationID || '') as string;

  const recordLogger = createChildLogger(baseLogger, { correlationId, userId, organizationID, sequenceNumber });

  recordLogger.info({
    event: 'inviteNotificationStream_processing',
    emailInvite: oldInviteDetails?.email,
    smsInvite: oldInviteDetails?.sms,
  });

  // ── Email notification ─────────────────────────────────────────────────────
  if (oldInviteDetails?.email && oldInviteDetails?.email === true) {
    if (!SEND_EMAIL_API_URL) {
      recordLogger.warn({ event: 'inviteNotificationStream_email_no_url', message: 'SEND_EMAIL_API_URL not configured' });
    } else {
      try {
        recordLogger.info({ event: 'inviteNotificationStream_email_sending', emailAddress });

        await axios.post(
          SEND_EMAIL_API_URL,
          {
            userId,
            emailAddress,
            fullName,
            organizationID,
            type: 'INVITE',
          },
          { timeout: 10_000 },
        );

        recordLogger.info({ event: 'inviteNotificationStream_email_sent', emailAddress });
      } catch (err) {
        // Log and continue — do not let an email failure block SMS
        recordLogger.error({
          event: 'inviteNotificationStream_email_error',
          emailAddress,
          err: serializeError(err),
        });
      }
    }
  }

  // ── SMS notification ───────────────────────────────────────────────────────
  if (oldInviteDetails?.sms && oldInviteDetails?.sms === true) {
    if (!SMS_API_URL) {
      recordLogger.warn({ event: 'inviteNotificationStream_sms_no_url', message: 'SMS_API_URL not configured' });
    } else {
      try {
        recordLogger.info({ event: 'inviteNotificationStream_sms_sending', phoneNumber });

        await axios.post(
          SMS_API_URL,
          {
            userId,
            phoneNumber,
            fullName,
            organizationID,
            type: 'INVITE',
          },
          { timeout: 10_000 },
        );

        recordLogger.info({ event: 'inviteNotificationStream_sms_sent', phoneNumber });
      } catch (err) {
        recordLogger.error({
          event: 'inviteNotificationStream_sms_error',
          phoneNumber,
          err: serializeError(err),
        });
      }
    }
  }
}

// ── Lambda entry point ─────────────────────────────────────────────────────────

export const main = async (event: DynamoDBStreamEvent): Promise<void> => {
  const correlationId = `stream-${Date.now()}`;
  const logger = createChildLogger(baseLogger, { correlationId, handler: 'inviteNotificationStreamHandler' });

  logger.info({ event: 'inviteNotificationStream_received', recordCount: event.Records.length });

  const processedSequenceNumbers = new Set<string>();

  for (const record of event.Records) {
    const sequenceNumber = record.dynamodb?.SequenceNumber;

    // De-duplicate (safety net for at-least-once delivery)
    if (sequenceNumber && processedSequenceNumbers.has(sequenceNumber)) {
      logger.warn({ event: 'inviteNotificationStream_duplicate', sequenceNumber });
      continue;
    }
    if (sequenceNumber) processedSequenceNumbers.add(sequenceNumber);

    try {
      await processRecord(record, correlationId);
    } catch (err) {
      logger.error({
        event: 'inviteNotificationStream_record_error',
        sequenceNumber,
        err: serializeError(err),
      });
      // Do not re-throw — allows remaining records in the batch to be processed
    }
  }

  logger.info({ event: 'inviteNotificationStream_complete' });
};
