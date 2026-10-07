import {
  classifyVendorLifecycleTransition,
  mapVendorLifecycleStreamRecord,
  toVendorLifecyclePayload,
} from './map-vendor-lifecycle-stream';

const image = {
  entityType: 'Vendor',
  vendorId: 'vendor-1',
  status: 'ACTIVE',
  onboardingStatus: 'PENDING_REVIEW',
  ownerUserId: 'user-1',
  latestReview: {
    reviewerUserId: 'admin-1',
    reviewedAt: '2026-01-02T00:00:00.000Z',
    previousStatus: 'PENDING_VERIFICATION',
    newStatus: 'ACTIVE',
  },
  meta: { correlationId: 'corr-1' },
};

describe('vendor lifecycle stream mapping', () => {
  it('classifies approval and rejection only', () => {
    expect(
      classifyVendorLifecycleTransition(
        { entityType: 'Vendor', status: 'PENDING_VERIFICATION' },
        { entityType: 'Vendor', status: 'ACTIVE' },
      ),
    ).toBe('approved');
    expect(
      classifyVendorLifecycleTransition(
        { entityType: 'Vendor', status: 'PENDING_VERIFICATION' },
        { entityType: 'Vendor', status: 'REJECTED' },
      ),
    ).toBe('rejected');
    expect(
      classifyVendorLifecycleTransition(
        { entityType: 'Vendor', status: 'ACTIVE' },
        { entityType: 'Vendor', status: 'SUSPENDED' },
      ),
    ).toBeUndefined();
  });

  it('builds a payload from the persisted review', () => {
    const payload = toVendorLifecyclePayload(
      { status: 'PENDING_VERIFICATION' },
      image,
    );
    expect(payload).toMatchObject({
      vendorId: 'vendor-1',
      previousStatus: 'PENDING_VERIFICATION',
      newStatus: 'ACTIVE',
      actorUserId: 'admin-1',
      ownerUserId: 'user-1',
    });
    expect(payload).not.toHaveProperty('email');
  });

  it('maps a stream record to VendorApproved', () => {
    const event = mapVendorLifecycleStreamRecord({
      eventID: 'evt-1',
      eventName: 'MODIFY',
      eventSource: 'aws:dynamodb',
      awsRegion: 'us-east-1',
      dynamodb: {
        Keys: { PK: { S: 'VENDOR#vendor-1' }, SK: { S: 'PROFILE' } },
        OldImage: {
          entityType: { S: 'Vendor' },
          status: { S: 'PENDING_VERIFICATION' },
        },
        NewImage: {
          entityType: { S: 'Vendor' },
          vendorId: { S: 'vendor-1' },
          ownerUserId: { S: 'user-1' },
          status: { S: 'ACTIVE' },
          onboardingStatus: { S: 'PENDING_REVIEW' },
          latestReview: {
            M: {
              reviewerUserId: { S: 'admin-1' },
              reviewedAt: { S: '2026-01-02T00:00:00.000Z' },
              previousStatus: { S: 'PENDING_VERIFICATION' },
              newStatus: { S: 'ACTIVE' },
            },
          },
          meta: { M: { correlationId: { S: 'corr-1' } } },
        },
      },
    });

    expect(event.eventType).toBe('VendorApproved');
    expect(event.eventVersion).toBe('1.0.0');
    expect(event.payload.actorUserId).toBe('admin-1');
    expect(event.payload.ownerUserId).toBe('user-1');
    expect(event.meta.correlationId).toBe('corr-1');
    expect(event.idempotencyKey).toBe(
      'VendorApproved:vendor-1:2026-01-02T00:00:00.000Z',
    );
  });
});
