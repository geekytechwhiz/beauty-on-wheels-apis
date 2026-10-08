import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { getLogger } from '@api-hub/observability';

import { DeliveryStoreError } from '../domain/errors.js';
import { DELIVERY_STATUS } from '../domain/delivery-status.js';
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
      if (error instanceof DeliveryStoreError) {
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }
      getLogger().error('email_delivery_event_dropped', error, {
        messageId: record.messageId,
        errorCode: 'DELIVERY_EVENT_INVALID',
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
  const log = getLogger({
    messageId: parsed.mail.messageId,
    status,
    sesEventType: parsed.eventType,
  });

  if (result === 'missing') {
    throw new DeliveryStoreError(
      `No delivery record for SES message ${parsed.mail.messageId}`,
    );
  }
  if (status === DELIVERY_STATUS.BOUNCED) {
    deliveryMetrics.count(EMAIL_METRIC.BOUNCE);
  }
  if (status === DELIVERY_STATUS.COMPLAINED) {
    deliveryMetrics.count(EMAIL_METRIC.COMPLAINT);
  }
  if (status === DELIVERY_STATUS.REJECTED) {
    deliveryMetrics.count(EMAIL_METRIC.DELIVERY_FAILURES);
  }
  log.info('email_delivery_lifecycle', {
    messageId: parsed.mail.messageId,
    status,
    result,
    sesEventType: parsed.eventType,
  });
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
