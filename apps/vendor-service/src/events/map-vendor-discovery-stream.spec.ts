import { StreamRecordFilteredError } from '@api-hub/event-platform';

import {
  classifyVendorDiscoveryChange,
  mapVendorDiscoveryStreamRecord,
} from './map-vendor-discovery-stream';

describe('vendor discovery stream mapping', () => {
  it('publishes branch, coverage, pricing, and operational changes only', () => {
    expect(classifyVendorDiscoveryChange('INSERT', undefined, {
      entityType: 'VendorBranch',
      vendorId: 'vendor-1',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })).toEqual({
      vendorId: 'vendor-1',
      updatedAt: '2026-02-01T00:00:00.000Z',
      subject: 'branch',
    });
    expect(classifyVendorDiscoveryChange('MODIFY', undefined, {
      entityType: 'ServiceArea',
      vendorId: 'vendor-1',
      updatedAt: '2026-02-02T00:00:00.000Z',
    })?.subject).toBe('coverage');
    expect(classifyVendorDiscoveryChange('MODIFY', undefined, {
      entityType: 'VendorCapabilities',
      vendorId: 'vendor-1',
      updatedAt: '2026-02-03T00:00:00.000Z',
    })?.subject).toBe('pricing');
    expect(classifyVendorDiscoveryChange(
      'MODIFY',
      { entityType: 'Vendor', SK: 'PROFILE', operationalStatus: 'OFFLINE' },
      {
        entityType: 'Vendor',
        SK: 'PROFILE',
        vendorId: 'vendor-1',
        operationalStatus: 'ONLINE',
        updatedAt: '2026-02-04T00:00:00.000Z',
      },
    )?.subject).toBe('operations');
    expect(classifyVendorDiscoveryChange(
      'MODIFY',
      { entityType: 'Vendor', SK: 'PROFILE', operationalStatus: 'ONLINE', status: 'ACTIVE' },
      {
        entityType: 'Vendor',
        SK: 'PROFILE',
        vendorId: 'vendor-1',
        operationalStatus: 'ONLINE',
        status: 'SUSPENDED',
        updatedAt: '2026-02-05T00:00:00.000Z',
      },
    )).toBeUndefined();
    expect(classifyVendorDiscoveryChange('REMOVE', {
      entityType: 'VendorBranch',
      vendorId: 'vendor-1',
      updatedAt: '2026-02-01T00:00:00.000Z',
    }, undefined)?.subject).toBe('branch');
    expect(classifyVendorDiscoveryChange('REMOVE', {
      entityType: 'VendorCommunity',
      vendorId: 'vendor-1',
      communityId: 'community-1',
      updatedAt: '2026-02-06T00:00:00.000Z',
    }, undefined)).toEqual({
      vendorId: 'vendor-1',
      updatedAt: '2026-02-06T00:00:00.000Z',
      subject: 'community',
      communityId: 'community-1',
    });
    expect(classifyVendorDiscoveryChange('INSERT', undefined, {
      entityType: 'VendorCommunity',
      vendorId: 'vendor-1',
      communityId: 'community-1',
      updatedAt: '2026-02-07T00:00:00.000Z',
    })).toBeUndefined();
  });

  it('maps a branch insert onto VendorDiscoveryChanged', () => {
    const event = mapVendorDiscoveryStreamRecord({
      eventID: 'evt-9',
      eventName: 'INSERT',
      eventSource: 'aws:dynamodb',
      awsRegion: 'us-east-1',
      dynamodb: {
        NewImage: {
          entityType: { S: 'VendorBranch' },
          vendorId: { S: 'vendor-1' },
          branchId: { S: 'branch-1' },
          phoneNumber: { S: '9999999999' },
          updatedAt: { S: '2026-02-01T00:00:00.000Z' },
        },
      },
    });
    expect(event.eventType).toBe('VendorDiscoveryChanged');
    expect(event.payload).toEqual({
      vendorId: 'vendor-1',
      updatedAt: '2026-02-01T00:00:00.000Z',
      subject: 'branch',
    });
    expect(event.idempotencyKey).toBe('VendorDiscoveryChanged:evt-9');
    expect(event.payload).not.toHaveProperty('phoneNumber');
  });

  it('filters unrelated vendor child items', () => {
    expect(() => mapVendorDiscoveryStreamRecord({
      eventID: 'evt-staff',
      eventName: 'MODIFY',
      eventSource: 'aws:dynamodb',
      awsRegion: 'us-east-1',
      dynamodb: {
        NewImage: {
          entityType: { S: 'Staff' },
          vendorId: { S: 'vendor-1' },
          updatedAt: { S: '2026-02-01T00:00:00.000Z' },
        },
      },
    })).toThrow(StreamRecordFilteredError);
  });
});
