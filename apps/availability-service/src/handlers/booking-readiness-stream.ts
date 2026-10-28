import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamEvent } from 'aws-lambda';

import { publishAvailabilityBookingReadiness } from '../events/publish-booking-readiness';

const PROJECTED_TYPES = new Set(['CommunityVisitSchedule', 'CommunityVisit']);

export async function handler(event: DynamoDBStreamEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const image = record.eventName === 'REMOVE' ? record.dynamodb?.OldImage : record.dynamodb?.NewImage;
      const row = image ? unmarshall(image as never) as { entityType?: unknown; vendorId?: unknown; status?: unknown } : undefined;
      if (!row || !PROJECTED_TYPES.has(String(row.entityType)) || typeof row.vendorId !== 'string') continue;
      const trigger = row.entityType === 'CommunityVisit' && (record.eventName === 'REMOVE' || row.status === 'cancelled')
        ? 'disabled' as const
        : 'updated' as const;
      await publishAvailabilityBookingReadiness({
        vendorId: row.vendorId,
        correlationId: record.eventID ?? row.vendorId,
        trigger,
      });
    } catch {
      if (record.eventID) batchItemFailures.push({ itemIdentifier: record.eventID });
    }
  }
  return { batchItemFailures };
}
