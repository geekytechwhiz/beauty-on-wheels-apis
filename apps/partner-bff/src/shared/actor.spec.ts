import type { LambdaRequest } from '@api-hub/utils';

import type { PartnerInternalClient } from '../clients/partner-internal.client';
import { resolvePartnerActor } from './actor';
import { remainingWindowMinutes } from './time';

const client = (membership: unknown): PartnerInternalClient => ({
  resolveOperationalAccess: jest.fn(async () => membership),
  readBooking: jest.fn(),
  readVendor: jest.fn(),
});

function request(authContext?: Record<string, unknown>, headers?: Record<string, string>): LambdaRequest {
  return {
    event: { headers } as LambdaRequest['event'],
    context: { correlationId: 'correlation-1', authContext } as LambdaRequest['context'],
    params: {},
  } as LambdaRequest;
}

describe('resolvePartnerActor', () => {
  it('fails closed without authorizer identity', async () => {
    await expect(resolvePartnerActor(request(), client({ active: true, role: 'owner', vendorId: 'vendor-a' })))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a verified user that lacks manager permission', async () => {
    await expect(resolvePartnerActor(request({ identityId: 'identity', userId: 'user-a', roles: ['customer'], permissions: [] }), client({ active: true, role: 'owner', vendorId: 'vendor-a' })))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('uses canonical membership and ignores spoofed client vendor headers', async () => {
    const access = client({ active: true, role: 'owner', vendorId: 'vendor-canonical' });
    const actor = await resolvePartnerActor(
      request(
        { identityId: 'identity', userId: 'user-a', roles: ['manager'], permissions: [] },
        { 'x-vendor-id': 'vendor-spoofed', 'x-user-id': 'other-user' },
      ),
      access,
    );
    expect(actor).toMatchObject({ userId: 'user-a', vendorId: 'vendor-canonical' });
    expect(access.resolveOperationalAccess).toHaveBeenCalledWith('user-a');
  });

  it('rejects an actor when canonical membership is for a non-owner scope', async () => {
    await expect(resolvePartnerActor(
      request({ identityId: 'identity', userId: 'user-a', roles: ['manager'], permissions: [] }),
      client({ active: true, role: 'staff', vendorId: 'vendor-a' }),
    )).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('operations time', () => {
  it('never returns positive minutes for an ended service window', () => {
    expect(remainingWindowMinutes('2026-11-13', '09:00', new Date('2026-11-13T10:00:00+05:30'))).toBe(0);
  });
});
