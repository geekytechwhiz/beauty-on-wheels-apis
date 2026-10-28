import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamEvent } from 'aws-lambda';

import { publishVendorBookingReadiness } from '../events/publish-vendor-booking-readiness';

const PROJECTED_TYPES = new Set(['Vendor', 'VendorCommunity', 'VendorCapabilities', 'Staff', 'VendorBank']);

/**
 * Vendor-owned changes are the outbox. This handler publishes the authoritative
 * summary; it does not write the readiness projection, so the stream cannot recurse.
 */
export async function handler(event: DynamoDBStreamEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const image = record.eventName === 'REMOVE' ? record.dynamodb?.OldImage : record.dynamodb?.NewImage;
      const row = image ? unmarshall(image as never) as { entityType?: unknown; vendorId?: unknown; PK?: unknown } : undefined;
      if (!row || !PROJECTED_TYPES.has(String(row.entityType))) continue;
      const vendorId = typeof row.vendorId === 'string'
        ? row.vendorId
        : typeof row.PK === 'string' && row.PK.startsWith('VENDOR#')
          ? row.PK.slice('VENDOR#'.length)
          : undefined;
      if (!vendorId) continue;
      await publishVendorBookingReadiness(vendorId, record.eventID ?? vendorId);
    } catch {
      if (record.eventID) batchItemFailures.push({ itemIdentifier: record.eventID });
    }
  }
  return { batchItemFailures };
}
