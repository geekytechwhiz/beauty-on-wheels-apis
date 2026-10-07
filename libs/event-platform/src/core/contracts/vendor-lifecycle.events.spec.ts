import {
  VendorApprovedEvent,
  VendorRejectedEvent,
  VENDOR_APPROVED_EVENT_TYPE,
  VENDOR_LIFECYCLE_EVENT_VERSION,
  VENDOR_REJECTED_EVENT_TYPE,
  vendorLifecycleIdempotencyKey,
} from './vendor-lifecycle.events';
import { getRegisteredEventDefinition } from '../../governance/event-registry';
import { getSchemaMeta } from '../schema/schema-meta';

const payload = {
  vendorId: 'vendor-1',
  previousStatus: 'PENDING_VERIFICATION',
  newStatus: 'ACTIVE',
  actorUserId: 'admin-1',
  reviewedAt: '2026-01-02T00:00:00.000Z',
  onboardingStatus: 'PENDING_REVIEW',
};

describe('Vendor lifecycle events', () => {
  it('registers VendorApproved and VendorRejected', () => {
    expect(getSchemaMeta(VendorApprovedEvent).eventType).toBe(
      VENDOR_APPROVED_EVENT_TYPE,
    );
    expect(getSchemaMeta(VendorApprovedEvent).eventVersion).toBe(
      VENDOR_LIFECYCLE_EVENT_VERSION,
    );
    expect(getRegisteredEventDefinition(VENDOR_REJECTED_EVENT_TYPE)?.classification).toBe(
      'domain',
    );
  });

  it('accepts a transition payload without contact details', () => {
    expect(VendorApprovedEvent.parse(payload).vendorId).toBe('vendor-1');
    expect(
      VendorRejectedEvent.parse({
        ...payload,
        newStatus: 'REJECTED',
        reason: 'Incomplete documents',
      }).reason,
    ).toBe('Incomplete documents');
  });

  it('builds a stable idempotency key from the review timestamp', () => {
    expect(
      vendorLifecycleIdempotencyKey(
        VENDOR_APPROVED_EVENT_TYPE,
        'vendor-1',
        payload.reviewedAt,
      ),
    ).toBe('VendorApproved:vendor-1:2026-01-02T00:00:00.000Z');
  });
});
