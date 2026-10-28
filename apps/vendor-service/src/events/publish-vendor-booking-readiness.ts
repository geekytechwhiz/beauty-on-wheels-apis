import {
  BOOKING_READINESS_FACT_SOURCES,
  BookingReadinessOutboxRepository,
  publishAuthoritativeFact,
  vendorReadinessTransition,
  type BookingReadinessFactPayload,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';
import { ensureVendorEventPlatform } from './configure-vendor-event-platform';
import {
  VendorReadinessSnapshotService,
  type VendorReadinessSnapshotLoader,
} from '../services/booking-readiness-snapshot';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

let outbox: BookingReadinessOutboxRepository | undefined;
let snapshots: VendorReadinessSnapshotLoader | undefined;

export function getVendorReadinessOutbox(): BookingReadinessOutboxRepository {
  if (!outbox) {
    outbox = new BookingReadinessOutboxRepository(env.DYNAMODB_TABLE_NAME, VendorKeyBuilder.vendorPk);
  }
  return outbox;
}

function snapshotLoader(): VendorReadinessSnapshotLoader {
  if (!snapshots) snapshots = new VendorReadinessSnapshotService();
  return snapshots;
}

/** Persists the vendor-owned summary, then publishes that exact version. */
export async function publishVendorBookingReadiness(
  vendorId: string,
  correlationId: string,
  loader: VendorReadinessSnapshotLoader = snapshotLoader(),
): Promise<BookingReadinessFactPayload | null> {
  const detail = await loader.load(vendorId);
  if (!detail) return null;
  ensureVendorEventPlatform();
  return publishAuthoritativeFact({
    outbox: getVendorReadinessOutbox(),
    vendorId,
    source: BOOKING_READINESS_FACT_SOURCES.VENDOR,
    detail,
    transition: (current) => vendorReadinessTransition(
      current?.detail.fact === 'vendor' ? current.detail : null,
      detail,
    ),
    correlationId,
  });
}
