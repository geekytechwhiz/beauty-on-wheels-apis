import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { getLogger } from '@api-hub/observability';

import { DeliveryStoreError } from '../domain/errors.js';
import {
  SesLifecycleEventSchema,
  deliveryStatusForSesEvent,
} from './ses-lifecycle-event.js';
import { EMAIL_METRIC } from '../observability/email-metrics.js';
import type { EmailDeliveryStore } from '../idempotency/email-delivery-store.js';
import type { EmailMetrics } from '../observability/email-metrics.js';

export async function applySesLifecycleBatch(
  event: SQSEvent,
  store: EmailDeliveryStore,
  deliveryMetrics: EmailMetrics,
): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records ?? []) {
    try {
      await applySesLifecycleRecord(record, store, deliveryMetrics);
    } catch (error) {
      // Every unexpected processing error must be retried by SQS. Valid, ignored
      // transitions (for example SENT -> SENT) do not throw and are acknowledged.
      failures.push({ itemIdentifier: record.messageId });
      getLogger().error('email_delivery_lifecycle_processing_failed', error, {
        messageId: record.messageId,
        errorCode:
          error instanceof DeliveryStoreError
            ? 'DELIVERY_STORE_ERROR'
            : 'DELIVERY_EVENT_INVALID',
      });
      deliveryMetrics.count(EMAIL_METRIC.DELIVERY_FAILURES);
    }
  }
  return { batchItemFailures: failures };
}

async function applySesLifecycleRecord(
  record: SQSRecord,
  store: EmailDeliveryStore,
  deliveryMetrics: EmailMetrics,
): Promise<void> {
  const body = JSON.parse(record.body) as unknown;
  const detail = unwrapDetail(body);
  const parsed = SesLifecycleEventSchema.parse(detail);
  const status = deliveryStatusForSesEvent(parsed.eventType);
  const result = await store.recordLifecycle(parsed.mail.messageId, status);
  const fields = lifecycleLogFields(parsed, eventSourceOf(body));
  const log = getLogger({
    messageId: parsed.mail.messageId,
    status,
    sesEventType: parsed.eventType,
  });

  if (result === 'missing') {
    log.warn('email_delivery_lifecycle_orphan', {
      ...fields,
      result,
      orphanLifecycleEvent: true,
    });
    throw new DeliveryStoreError(
      `No delivery record for SES message ${parsed.mail.messageId}`,
    );
  }
  if (status === 'bounced') {
    deliveryMetrics.count(EMAIL_METRIC.BOUNCE);
  }
  if (status === 'complained') {
    deliveryMetrics.count(EMAIL_METRIC.COMPLAINT);
  }
  if (status === 'rejected' || status === 'renderingFailed') {
    deliveryMetrics.count(EMAIL_METRIC.DELIVERY_FAILURES);
  }
  log.info('email_delivery_lifecycle', {
    result,
    ...fields,
  });
}

/** Extract only operational metadata; never emit recipient addresses or message content. */
function lifecycleLogFields(
  event: {
    eventType: string;
    mail: Record<string, unknown>;
    [key: string]: unknown;
  },
  eventSource?: string,
): Record<string, unknown> {
  const mail = event.mail;
  const destination = firstString(mail.destination);
  const tags = objectValue(mail.tags);
  const configurationSet = firstString(tags?.['ses:configuration-set']);
  const eventPayload = objectValue(event[eventKeyFor(event.eventType)]);

  return compact({
    messageId: stringValue(mail.messageId),
    sesEventType: event.eventType,
    correlationId: firstString(tags?.correlationId),
    eventTimestamp:
      stringValue(eventPayload?.timestamp) ?? stringValue(mail.timestamp),
    recipientDomain: domainOf(destination),
    eventSource,
    configurationSet,
    bounceType: stringValue(eventPayload?.bounceType),
    bounceSubType: stringValue(eventPayload?.bounceSubType),
    diagnosticCode: stringValue(
      firstObject(eventPayload?.bouncedRecipients)?.diagnosticCode,
    ),
    smtpResponse: stringValue(eventPayload?.smtpResponse),
    rejectReason: stringValue(eventPayload?.reason),
    complaintFeedbackType: stringValue(eventPayload?.complaintFeedbackType),
    renderingFailureReason: stringValue(eventPayload?.errorMessage),
    deliveryDelayType: stringValue(eventPayload?.delayType),
    deliveryDelayReason: stringValue(eventPayload?.delayReason),
  });
}

function eventSourceOf(body: unknown): string | undefined {
  return body && typeof body === 'object'
    ? stringValue((body as Record<string, unknown>).source)
    : undefined;
}

function eventKeyFor(eventType: string): string {
  return eventType === 'Rendering Failure'
    ? 'renderingFailure'
    : eventType === 'DeliveryDelay'
      ? 'deliveryDelay'
      : eventType.toLowerCase();
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstObject(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? objectValue(value[0]) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? stringValue(value[0]) : stringValue(value);
}

function domainOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const at = address.lastIndexOf('@');
  return at >= 0 && at < address.length - 1
    ? address.slice(at + 1).toLowerCase()
    : undefined;
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function unwrapDetail(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }
  const envelope = body as Record<string, unknown>;
  if ('detail' in envelope && typeof envelope.source === 'string') {
    return envelope.detail;
  }
  return body;
}
