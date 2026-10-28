import { BaseRepository } from '@api-hub/utils';
import {
  BOOKING_READINESS_FACT_SOURCES,
  BOOKING_READINESS_TRANSITIONS,
  BookingReadinessOutboxRepository,
  countTransitionFrom,
  publishAuthoritativeFact,
  type BookingReadinessFactPayload,
  type BookingReadinessTransition,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';
import { activeValidVisitScheduleCount } from '../domain/booking-readiness-facts';
import type { CommunityVisitScheduleRecord, DatedCommunityVisitRecord } from '../repositories/community-visits.repository';
import { ensureAvailabilityEventPlatform } from './configure-availability-event-platform';

class AvailabilityReadinessReader extends BaseRepository {
  private table() {
    return env.DYNAMODB_TABLE_NAME;
  }

  schedules(vendorId: string): Promise<CommunityVisitScheduleRecord[]> {
    return this.queryAll<CommunityVisitScheduleRecord & { entityType?: string }>({
      TableName: this.table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `VENDOR#${vendorId}`, ':prefix': 'CVISIT_SCHEDULE#' },
      ConsistentRead: true,
    }).then((items) => items.filter((item) => item.entityType === 'CommunityVisitSchedule'));
  }

  visits(vendorId: string): Promise<DatedCommunityVisitRecord[]> {
    return this.queryAll<DatedCommunityVisitRecord & { entityType?: string }>({
      TableName: this.table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `VENDOR#${vendorId}`, ':prefix': 'CVISIT#' },
      ConsistentRead: true,
    }).then((items) => items.filter((item) => item.entityType === 'CommunityVisit'));
  }
}

let outbox: BookingReadinessOutboxRepository | undefined;
let reader: AvailabilityReadinessReader | undefined;

function availabilityOutbox(): BookingReadinessOutboxRepository {
  if (!outbox) outbox = new BookingReadinessOutboxRepository(env.DYNAMODB_TABLE_NAME, (vendorId) => `VENDOR#${vendorId}`);
  return outbox;
}

export async function publishAvailabilityBookingReadiness(input: {
  vendorId: string;
  correlationId: string;
  trigger?: BookingReadinessTransition;
  now?: Date;
}): Promise<BookingReadinessFactPayload> {
  if (!reader) reader = new AvailabilityReadinessReader();
  const [schedules, visits] = await Promise.all([
    reader.schedules(input.vendorId),
    reader.visits(input.vendorId),
  ]);
  const count = activeValidVisitScheduleCount(schedules, visits, input.now ?? new Date());
  ensureAvailabilityEventPlatform();
  return publishAuthoritativeFact({
    outbox: availabilityOutbox(),
    vendorId: input.vendorId,
    source: BOOKING_READINESS_FACT_SOURCES.AVAILABILITY,
    correlationId: input.correlationId,
    detail: { fact: 'visitSchedules', activeValidVisitScheduleCount: count },
    transition: (current) => countTransitionFrom(
      current,
      'visitSchedules',
      count,
      input.trigger ?? BOOKING_READINESS_TRANSITIONS.UPDATED,
    ),
  });
}
