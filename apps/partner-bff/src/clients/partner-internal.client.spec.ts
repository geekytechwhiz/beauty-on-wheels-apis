import { HttpPartnerInternalClient, type PartnerActor } from './partner-internal.client';

const actor: PartnerActor = {
  userId: 'user-1',
  vendorId: 'vendor-1',
  roles: ['VENDOR'],
  permissions: [],
  correlationId: 'c-1',
};

describe('HttpPartnerInternalClient', () => {
  it('posts Booking manager reads with the internal bearer and never a user JWT', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          timezone: 'Asia/Kolkata',
          days: [],
          issues: [],
          issuesAvailable: true,
          sourceAsOf: '2026-11-13T00:00:00.000Z',
        },
      }),
    );
    const client = new HttpPartnerInternalClient(
      {
        bookingBaseUrl: 'https://booking.example/dev',
        vendorBaseUrl: 'https://vendor.example/dev',
        internalServiceToken: 'platform-internal-token',
      },
      fetchImpl as unknown as typeof fetch,
    );

    await client.readBooking(actor, 'overview', { dates: '2026-11-13' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://booking.example/dev/internal/partner/manager/read',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer platform-internal-token',
        }),
        body: JSON.stringify({ actor, action: 'overview', query: { dates: '2026-11-13' } }),
      }),
    );
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(JSON.stringify(headers)).not.toContain('user-jwt');
  });

  it('maps a transport failure to a retryable dependency error', async () => {
    const client = new HttpPartnerInternalClient(
      {
        bookingBaseUrl: 'https://booking.example/dev',
        vendorBaseUrl: 'https://vendor.example/dev',
        internalServiceToken: 'token',
      },
      jest.fn(async () => {
        throw Object.assign(new Error('boom'), { name: 'TimeoutError' });
      }) as unknown as typeof fetch,
    );
    await expect(client.readVendor(actor, { includeCrews: true })).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      statusCode: 502,
      retryable: true,
    });
  });

  it('returns Vendor crews with their point of contact from the data envelope', async () => {
    const crews = [
      {
        crewId: 'crew-1',
        pointOfContact: {
          staffId: 'staff-1',
          name: 'Asha',
          phoneNumber: '+919800000000',
          source: 'firstActiveMember',
        },
      },
    ];
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ success: true, data: { crews, sourceAsOf: '2026-11-13T00:00:00.000Z' } }),
    );
    const client = new HttpPartnerInternalClient(
      {
        bookingBaseUrl: 'https://booking.example/dev',
        vendorBaseUrl: 'https://vendor.example/dev',
        internalServiceToken: 'token',
      },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.readVendor(actor, { includeCrews: true })).resolves.toEqual({
      crews,
      sourceAsOf: '2026-11-13T00:00:00.000Z',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      actor,
      includeCrews: true,
    });
  });

  it('resolves operational access through the vendor internal HTTP route', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        success: true,
        data: { role: 'owner', vendorId: 'vendor-1', active: true },
      }),
    );
    const client = new HttpPartnerInternalClient(
      {
        bookingBaseUrl: 'https://booking.example/dev',
        vendorBaseUrl: 'https://vendor.example/dev',
        internalServiceToken: 'token',
      },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.resolveOperationalAccess('user-1')).resolves.toEqual({
      role: 'owner',
      vendorId: 'vendor-1',
      active: true,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://vendor.example/dev/internal/operational-access',
    );
  });

  it('fails closed when base URL or internal token is missing', async () => {
    const client = new HttpPartnerInternalClient(
      { bookingBaseUrl: '', vendorBaseUrl: '', internalServiceToken: '' },
      jest.fn() as unknown as typeof fetch,
    );
    await expect(client.resolveOperationalAccess('user-1')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      statusCode: 502,
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
