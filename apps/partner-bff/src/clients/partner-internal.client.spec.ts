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

  it('loads vendor home summary via Booking homeSummary (not the bookings list)', async () => {
    const summary = {
      vendorId: 'vendor-1',
      timezone: 'Asia/Kolkata',
      date: '2026-11-13',
      today: {
        visits: {
          total: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          blocked: 0,
          missed: 0,
          cancelled: 0,
        },
        crew: { assigned: 0, unassigned: 0 },
        completion: { completed: 0, total: 0, percentage: 0 },
        needsAttention: [],
      },
      tomorrow: {
        date: '2026-11-14',
        totalVisits: 0,
        assignedVisits: 0,
        unassignedVisits: 0,
      },
      upcoming: {
        fromDate: '2026-11-14',
        toDate: '2026-11-16',
        days: [
          {
            date: '2026-11-14',
            totalVisits: 0,
            assignedVisits: 0,
            unassignedVisits: 0,
            communities: [],
          },
        ],
      },
    };
    const fetchImpl = jest.fn(async () => jsonResponse({ success: true, data: summary }));
    const client = new HttpPartnerInternalClient(
      {
        bookingBaseUrl: 'https://booking.example/dev',
        vendorBaseUrl: 'https://vendor.example/dev',
        internalServiceToken: 'platform-internal-token',
      },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(
      client.readHomeSummary(actor, { upcomingDays: 3 }),
    ).resolves.toEqual(summary);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://booking.example/dev/internal/partner/manager/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          actor,
          action: 'homeSummary',
          query: { upcomingDays: 3 },
        }),
      }),
    );
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

  it('surfaces the platform envelope description from a forbidden dependency response', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(
        {
          success: false,
          statusCode: 403,
          message: {
            title: 'Access denied',
            description: 'Delegated actor is not authorized for this vendor',
            severity: 'ERROR',
          },
          error: {
            code: 'FORBIDDEN',
            details: [{ message: 'Delegated actor is not authorized for this vendor' }],
          },
        },
        403,
      ),
    );
    const client = new HttpPartnerInternalClient(
      {
        bookingBaseUrl: 'https://booking.example/dev',
        vendorBaseUrl: 'https://vendor.example/dev',
        internalServiceToken: 'token',
      },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.readVendor(actor, { includeVendorContext: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
      message: 'Delegated actor is not authorized for this vendor',
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
