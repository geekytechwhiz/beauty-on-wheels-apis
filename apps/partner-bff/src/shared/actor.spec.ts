import type { LambdaRequest } from '@api-hub/utils';

import type { PartnerInternalClient } from '../clients/partner-internal.client';
import { resolvePartnerActor } from './actor';
import { remainingWindowMinutes } from './time';

const client = (membership: unknown): PartnerInternalClient => ({
  resolveOperationalAccess: jest.fn(async () => membership),
  readBooking: jest.fn(),
  readVendor: jest.fn(),
  readCapacityCommitments: jest.fn(async () => []),
  readHomeSummary: jest.fn(),
});

function request(
  authContext?: Record<string, unknown>,
  headers?: Record<string, string>,
  vendorId?: string,
): LambdaRequest {
  return {
    event: { headers } as LambdaRequest['event'],
    context: {
      correlationId: 'correlation-1',
      authContext,
    } as LambdaRequest['context'],
    pathParameters: vendorId ? { vendorId } : undefined,
    params: {},
  } as LambdaRequest;
}

describe('resolvePartnerActor', () => {
  it('fails closed without authorizer identity', async () => {
    await expect(
      resolvePartnerActor(
        request(),
        client({ active: true, role: 'owner', vendorId: 'vendor-a' }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a verified user that lacks a manager role', async () => {
    await expect(
      resolvePartnerActor(
        request(
          {
            identityId: 'identity',
            userId: 'user-a',
            roles: ['customer'],
            permissions: [],
          },
          undefined,
          'vendor-a',
        ),
        client({ active: true, role: 'owner', vendorId: 'vendor-a' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('uses canonical membership and ignores spoofed client vendor headers', async () => {
    const access = client({
      active: true,
      role: 'owner',
      vendorId: 'vendor-canonical',
    });
    const actor = await resolvePartnerActor(
      request(
        {
          identityId: 'identity',
          userId: 'user-a',
          roles: ['VENDOR'],
          permissions: ['communities:manage'],
        },
        { 'x-vendor-id': 'vendor-spoofed', 'x-user-id': 'other-user' },
        'vendor-canonical',
      ),
      access,
    );
    expect(actor).toMatchObject({
      userId: 'user-a',
      vendorId: 'vendor-canonical',
      permissions: ['communities:manage'],
    });
    expect(access.resolveOperationalAccess).toHaveBeenCalledWith('user-a');
  });

  it('allows an active staff membership for the path vendor', async () => {
    const actor = await resolvePartnerActor(
      request(
        {
          identityId: 'identity',
          userId: 'staff-a',
          roles: ['BUDDY'],
          permissions: ['visits:view'],
        },
        undefined,
        'vendor-a',
      ),
      client({ active: true, role: 'staff', vendorId: 'vendor-a', staffId: 'staff-1' }),
    );
    expect(actor).toMatchObject({
      userId: 'staff-a',
      vendorId: 'vendor-a',
      permissions: ['visits:view'],
    });
  });

  it('rejects an unrelated authenticated user for another vendor', async () => {
    await expect(
      resolvePartnerActor(
        request(
          {
            identityId: 'identity',
            userId: 'user-a',
            roles: ['VENDOR'],
            permissions: [],
          },
          undefined,
          'vendor-other',
        ),
        client({ active: true, role: 'owner', vendorId: 'vendor-a' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows platform admins without vendor membership match', async () => {
    const access = client({ active: false, role: 'none' });
    const actor = await resolvePartnerActor(
      request(
        {
          identityId: 'identity',
          userId: 'admin-1',
          roles: ['ADMIN'],
          permissions: [],
        },
        undefined,
        'vendor-any',
      ),
      access,
    );
    expect(actor.vendorId).toBe('vendor-any');
    expect(access.resolveOperationalAccess).not.toHaveBeenCalled();
  });
});

describe('operations time', () => {
  it('never returns positive minutes for an ended service window', () => {
    expect(
      remainingWindowMinutes(
        '2026-11-13',
        '09:00',
        new Date('2026-11-13T10:00:00+05:30'),
      ),
    ).toBe(0);
  });
});
