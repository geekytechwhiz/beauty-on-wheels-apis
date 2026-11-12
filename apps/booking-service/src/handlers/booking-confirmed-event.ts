import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BookingConfirmedEvent,
  publishEvent,
  type BookingConfirmedPayload,
} from '@api-hub/event-platform';

import { ensureBookingEventPlatform } from '../events/configure-booking-event-platform';

type ConfirmationOutboxRecord = {
  entityType: 'BookingConfirmationOutbox';
  eventId: string;
  idempotencyKey: string;
  correlationId: string;
  payload: BookingConfirmedPayload;
};

/**
 * Publishes only atomic confirmation-outbox inserts. Throwing on failure lets
 * DynamoDB Streams retry; consumers deduplicate using the stable event key.
 */
export async function handleBookingConfirmedEvent(event: DynamoDBStreamEvent): Promise<void> {
  ensureBookingEventPlatform();
  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) continue;
    const outbox = unmarshall(record.dynamodb.NewImage as any) as ConfirmationOutboxRecord;
    if (outbox.entityType !== 'BookingConfirmationOutbox') continue;
    await publishEvent(BookingConfirmedEvent, outbox.payload, {
      eventId: outbox.eventId,
      idempotencyKey: outbox.idempotencyKey,
      meta: { correlationId: outbox.correlationId },
    });
  }
}
