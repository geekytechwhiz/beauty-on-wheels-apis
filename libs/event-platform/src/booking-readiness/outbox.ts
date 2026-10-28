import { randomUUID } from 'crypto';

import { ConditionalWriteConflictError, BaseRepository } from '@api-hub/utils';

import {
  bookingReadinessFactIdempotencyKey,
  BookingReadinessFactUpdatedEvent,
  planBookingReadinessFact,
  type BookingReadinessFactPayload,
  type BookingReadinessFactSource,
  type BookingReadinessTransition,
  type ReadinessOutboxState,
} from '../core/contracts/booking-readiness-fact.events';
import { publishEvent } from '../dx/publish-event';

const OUTBOX_SK = 'BOOKING_READINESS_OUTBOX';
const MAX_COMMIT_ATTEMPTS = 5;

type OutboxItem = ReadinessOutboxState & {
  PK: string;
  SK: string;
  entityType: 'BookingReadinessOutbox';
  vendorId: string;
  updatedAt: string;
};

export class BookingReadinessOutboxRepository extends BaseRepository {
  constructor(
    private readonly tableName: string,
    private readonly partitionKey: (vendorId: string) => string,
  ) {
    super();
  }

  async find(vendorId: string): Promise<ReadinessOutboxState | null> {
    const items = await this.queryAll<OutboxItem>({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': this.partitionKey(vendorId),
        ':sk': OUTBOX_SK,
      },
      ConsistentRead: true,
    });
    const item = items[0];
    if (!item || item.entityType !== 'BookingReadinessOutbox') return null;
    return {
      aggregateVersion: item.aggregateVersion,
      payload: item.payload,
      pendingPublish: item.pendingPublish === true,
    };
  }

  async commit(vendorId: string, expectedVersion: number | null, payload: BookingReadinessFactPayload): Promise<void> {
    await this.transactWrite({
      TransactItems: [{
        Put: {
          TableName: this.tableName,
          Item: {
            PK: this.partitionKey(vendorId),
            SK: OUTBOX_SK,
            entityType: 'BookingReadinessOutbox',
            vendorId,
            aggregateVersion: payload.aggregateVersion,
            payload,
            pendingPublish: true,
            updatedAt: payload.occurredAt,
          } satisfies OutboxItem,
          ConditionExpression: expectedVersion === null
            ? 'attribute_not_exists(aggregateVersion)'
            : 'aggregateVersion = :expected',
          ...(expectedVersion === null ? {} : { ExpressionAttributeValues: { ':expected': expectedVersion } }),
        },
      }],
    });
  }

  async markPublished(vendorId: string, aggregateVersion: number): Promise<void> {
    try {
      await this.update({
        TableName: this.tableName,
        Key: { PK: this.partitionKey(vendorId), SK: OUTBOX_SK },
        UpdateExpression: 'SET pendingPublish = :published',
        ConditionExpression: 'aggregateVersion = :version',
        ExpressionAttributeValues: { ':published': false, ':version': aggregateVersion },
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError) && !isConditional(error)) throw error;
    }
  }
}

export async function publishAuthoritativeFact(input: {
  outbox: BookingReadinessOutboxRepository;
  vendorId: string;
  source: BookingReadinessFactSource;
  transition: BookingReadinessTransition | ((current: BookingReadinessFactPayload | null) => BookingReadinessTransition);
  detail: BookingReadinessFactPayload['detail'] | ((current: BookingReadinessFactPayload | null) => BookingReadinessFactPayload['detail']);
  correlationId: string;
}): Promise<BookingReadinessFactPayload> {
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
    const current = await input.outbox.find(input.vendorId);
    const detail = typeof input.detail === 'function' ? input.detail(current?.payload ?? null) : input.detail;
    const transition = typeof input.transition === 'function' ? input.transition(current?.payload ?? null) : input.transition;
    const plan = planBookingReadinessFact({
      current,
      vendorId: input.vendorId,
      source: input.source,
      transition,
      detail,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
    });
    if (plan.action === 'skip') return plan.payload;
    try {
      if (plan.action === 'commit') await input.outbox.commit(input.vendorId, plan.expectedVersion, plan.payload);
      await publishEvent(BookingReadinessFactUpdatedEvent, plan.payload, {
        eventId: plan.payload.eventId,
        idempotencyKey: bookingReadinessFactIdempotencyKey(plan.payload),
        meta: { correlationId: input.correlationId },
      });
      await input.outbox.markPublished(input.vendorId, plan.payload.aggregateVersion);
      return plan.payload;
    } catch (error) {
      if (attempt < MAX_COMMIT_ATTEMPTS && (error instanceof ConditionalWriteConflictError || isConditional(error))) continue;
      throw error;
    }
  }
  throw new Error('Booking readiness fact commit conflicted');
}

function isConditional(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}
