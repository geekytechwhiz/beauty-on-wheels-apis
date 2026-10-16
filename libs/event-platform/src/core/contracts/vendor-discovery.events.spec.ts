import { getSchemaMeta } from '../schema/schema-meta';
import {
  VendorDiscoveryChangedEvent,
  vendorDiscoveryChangedIdempotencyKey,
} from './vendor-discovery.events';

describe('VendorDiscoveryChanged', () => {
  it('registers a versioned vendor discovery change', () => {
    expect(getSchemaMeta(VendorDiscoveryChangedEvent).eventType).toBe('VendorDiscoveryChanged');
    expect(getSchemaMeta(VendorDiscoveryChangedEvent).eventVersion).toBe('1.0.0');
    const payload = VendorDiscoveryChangedEvent.parse({
      vendorId: 'vendor-1',
      updatedAt: '2026-02-01T00:00:00.000Z',
      subject: 'pricing',
    });
    expect(payload.subject).toBe('pricing');
    expect(vendorDiscoveryChangedIdempotencyKey('evt-1')).toBe('VendorDiscoveryChanged:evt-1');
  });
});
