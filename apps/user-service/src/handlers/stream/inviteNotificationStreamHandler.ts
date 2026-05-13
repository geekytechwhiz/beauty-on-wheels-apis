import { DynamoDBStreamEvent } from 'aws-lambda';
import { createLogger, createChildLogger, serializeError } from '@api-hub/observability';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import axios from 'axios';
import { INVITE_EMAIL_SUBJECT, INVITE_EMAIL_MESSAGE, WELCOME_MESSAGE, WELCOME_DLT_CONTENT_ID, PORTAL_LINK } from '../../utils/constants';
import { sendEmail } from '../../services/notification.delivery';
import { getOrganizationFromDynamo } from '../../services/organization.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const SMS_API_URL = process.env.SMS_API_URL || '';

interface InviteDetails {
  email?: boolean;
  emailUpdatedAt?: string;
  sms?: boolean;
  smsUpdatedAt?: string;
}

/**
 * DynamoDB Stream handler for invite notifications.
 *
 * Fires on every MODIFY event on user-table.
 * - If newImage.inviteDetails.email === true  → POST to SEND_EMAIL_API_URL
 * - If newImage.inviteDetails.sms   === true  → POST to SMS_API_URL
 *
 * Only acts when inviteDetails has actually changed (old vs new comparison).
 */
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
      message: 'Not a MODIFY event: any, skipping',
    });
    return;
  }

  if (!record.dynamodb?.NewImage) {
    logger.warn({ event: 'inviteNotificationStream_no_image', message: 'No NewImage in stream record' });
    return;
  }

  const newItem = unmarshall(record.dynamodb.NewImage as Record<string, any>);
  const oldItem = record.dynamodb.OldImage
    ? unmarshall(record.dynamodb.OldImage as Record<string, any>)
    : {};
    // console.log("NEW ITEM",newItem)
    // console.log("OLD ITEM",oldItem)
  const newInviteDetails = newItem.inviteDetails as InviteDetails | undefined;
  const oldInviteDetails = oldItem.inviteDetails as InviteDetails | undefined;
  // console.log("NEW INVITE DETAILS",newInviteDetails)
  // console.log("OLD INVITE DETAILS",oldInviteDetails)
  // Skip if inviteDetails is not present in the new image or is an empty object
  if (!newInviteDetails || (typeof newInviteDetails === 'object' && Object.keys(newInviteDetails).length === 0)) {
    logger.info({ 
      event: 'inviteNotificationStream_no_inviteDetails', 
      message: 'inviteDetails not found or empty in NewImage, skipping',
      hasInviteDetails: !!newInviteDetails,
      inviteDetailsKeys: newInviteDetails ? Object.keys(newInviteDetails) : []
    });
    return;
  }

  // Only process if email or sms is explicitly set to true
  if (newInviteDetails.email !== true && newInviteDetails.sms !== true) {
    logger.info({ 
      event: 'inviteNotificationStream_no_action_needed', 
      message: 'inviteDetails present but email and sms are not true, skipping',
      email: newInviteDetails.email,
      sms: newInviteDetails.sms
    });
    return;
  }

  // Skip if inviteDetails has not changed
  if (JSON.stringify(newInviteDetails) === JSON.stringify(oldInviteDetails)) {
    logger.info({ event: 'inviteNotificationStream_unchanged', message: 'inviteDetails unchanged, skipping' });
    return;
  }

  const userId = (newItem.userID || newItem.userId || '') as string;
  const emailAddress = (newItem.emailAddress || '') as string;
  const phoneNumber = (newItem.phoneNumber || '') as string;
  const phoneCode = (newItem.phoneCode || '') as string;
  const organizationID = (newItem.organizationID || '') as string;
  const firstName = (newItem.firstName || '') as string;

  // organizationName / organizationAddress / organizationInfo are NOT stored on the
  // user-table item — they must always be fetched from the Organization service.
  let organizationName = '';
  let organizationAddress = '';
  let organizationInfo = '';

  if (organizationID) {
    try {
      const org = await getOrganizationFromDynamo(organizationID);
      // console.log("ORG RESPONSE : ",org)
      if (org && typeof org === 'object') {
        const orgData = org as any;
        const orgInfo: any = orgData.organizationInfo || {};

        if (!organizationName) {
          organizationName =
            orgInfo.organizationName ||
            orgInfo.name ||
            orgData.name ||
            organizationName;
        }

        if (!organizationAddress) {
          // Try nested organizationInfo.address object first
          if (orgInfo.address && typeof orgInfo.address === 'object') {
            const addr = orgInfo.address as any;
            organizationAddress = [addr.address, addr.city, addr.state, addr.country, addr.postalCode]
              .filter(Boolean)
              .join(', ');
          }

          // Fall back to top-level org fields (address, city, state, country, postalCode)
          if (!organizationAddress) {
            organizationAddress = [orgData.address, orgData.city, orgData.state, orgData.country, orgData.postalCode]
              .filter(Boolean)
              .join(', ');
          }
        }

        if (!organizationInfo) {
          const parts: string[] = [];
          if (organizationName) {
            parts.push(organizationName);
          }
          if (organizationAddress) {
            parts.push(organizationAddress);
          }
          organizationInfo = parts.join('<br>');
        }
      }
    } catch (err) {
      logger.warn({
        event: 'inviteNotificationStream_org_lookup_failed',
        organizationID,
        err: serializeError(err as Error),
      });
    }
  }

  // Final safety: ensure all ORG_* values are non-empty strings for template replacement
  organizationName = organizationName || 'No Organization';
  organizationAddress = organizationAddress || '';
  organizationInfo = typeof organizationInfo === 'string' ? organizationInfo : String(organizationInfo);
  // console.log("ORGANIZATION NAME : ",organizationName)
  // console.log("ORGANIZATION ADDRESS : ",organizationAddress)
  // console.log("ORGANIZATION INFO : ",organizationInfo)
  const recordLogger = createChildLogger(baseLogger, { correlationId, userId, organizationID, sequenceNumber });

  recordLogger.info({
    event: 'inviteNotificationStream_processing',
    emailInvite: newInviteDetails.email,
    smsInvite: newInviteDetails.sms,
  });

  // ── Email notification ─────────────────────────────────────────────────────
  if (newInviteDetails.email === true) {
    try {
      recordLogger.info({ event: 'inviteNotificationStream_email_sending', emailAddress });
      const subject = INVITE_EMAIL_SUBJECT
        .replace(/{{ORG_NAME}}/g, organizationName)
        .replace(/{{USER_FIRST_NAME}}/g, firstName);

      const body = INVITE_EMAIL_MESSAGE
        .replace(/{{ORG_NAME}}/g, organizationName)
        .replace(/{{USER_FIRST_NAME}}/g, firstName)
        .replace(/{{WEB_DNS_URL}}/g, process.env.WEB_URL || '')
        .replace(/{{HOSPITAL_ID}}/g, organizationID)
        .replace(/{{ORG_ADDRESS}}/g, organizationAddress)
        .replace(/{{TYPE}}/g, 'INVITE')       
        .replace(/{{DEVICE}}/g, '')        
        .replace(/{{ORG_INFO}}/g, organizationInfo);

      await sendEmail({
        email: emailAddress,
        template: 'GENERIC_NOTIFICATION',
        templateData: {
          TITLE: subject,
          BODY: body
        }
      });

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

  // ── SMS notification ───────────────────────────────────────────────────────
  if (newInviteDetails.sms === true) {
    if (!SMS_API_URL) {
      recordLogger.warn({ event: 'inviteNotificationStream_sms_no_url', message: 'SMS_API_URL not configured' });
    } else {
      try {
        recordLogger.info({ event: 'inviteNotificationStream_sms_sending', phoneNumber });
        const payload = {
          phoneNumber:  `${phoneCode}${phoneNumber}`,
          templateKey: "WELCOME_SMS",
          language: 'en',
          variables: {
            "orgName":organizationName,
          },
        };
        await axios.post(
          SMS_API_URL,
          {
              // "phoneNumber": `${phoneCode}${phoneNumber}`,
              // "templateKey": "WELCOME_SMS",
              // "language": "en",
              //   "variables": {
              //     "orgName":organizationName,
              //     "HOSPITAL_ID":organizationID,
              //     "ORG_ADDRESS":organizationAddress,
              //     "TYPE":'INVITE',
              //     "DEVICE":''
              // }
              ...payload
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