/**
 * Live Phase 1 customer foundation flow.
 * Uses the deployed APIs. It does not mock service responses.
 *
 * PHASE1_IDENTITY_BASE_URL  https://....amazonaws.com/dev
 * PHASE1_USER_BASE_URL
 * PHASE1_VEHICLE_BASE_URL
 */
const identityBase = process.env.PHASE1_IDENTITY_BASE_URL?.replace(/\/$/, '');
const userBase = process.env.PHASE1_USER_BASE_URL?.replace(/\/$/, '');
const vehicleBase = process.env.PHASE1_VEHICLE_BASE_URL?.replace(/\/$/, '');

const describeLive =
  identityBase && userBase && vehicleBase ? describe : describe.skip;

type Envelope = {
  success?: boolean;
  statusCode?: number;
  data?: any;
  error?: { code?: string } | null;
};

async function callApi(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Envelope) : {};
  return { status: response.status, body };
}

describeLive('Phase 1 customer foundation live API', () => {
  jest.setTimeout(90_000);

  const stamp = `${Date.now()}`;
  const email = `phase1.${stamp}@example.com`;
  const password = `Phase1!${stamp.slice(-6)}a`;
  let accessToken = '';
  let userId = '';
  let addressId = '';
  let vehicleId = '';

  function authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${accessToken}` };
  }

  it('registers, logs in, and reads /me', async () => {
    const registered = await callApi(`${identityBase}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Phase',
        lastName: 'One',
        email,
        password,
      }),
    });
    expect(registered.status).toBe(200);
    expect(registered.body.success).toBe(true);
    expect(registered.body.data?.id).toEqual(expect.any(String));

    const invalid = await callApi(`${identityBase}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: email, password: 'wrong-password' }),
    });
    expect(invalid.status).toBe(401);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error?.code).toBe('INVALID_CREDENTIALS');

    const login = await callApi(`${identityBase}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: email, password }),
    });
    expect(login.status).toBe(200);
    expect(login.body.data?.accessToken).toEqual(expect.any(String));
    expect(login.body.data?.refreshToken).toEqual(expect.any(String));
    accessToken = login.body.data.accessToken;

    const me = await callApi(`${identityBase}/me`, { headers: authHeaders() });
    expect(me.status).toBe(200);
    expect(me.body.data?.userId).toEqual(expect.any(String));
    expect(me.body.data?.email).toBe(email);
    expect(me.body.data).not.toHaveProperty('passwordHash');
    userId = me.body.data.userId;

    const anonymous = await callApi(`${identityBase}/me`);
    expect(anonymous.status).toBe(401);
  });

  it('updates the customer profile and manages an address', async () => {
    const profile = await callApi(`${userBase}/customers/${userId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        firstName: 'Phase',
        lastName: 'One',
        email,
        phone: '+919876543210',
      }),
    });
    expect(profile.status).toBe(200);
    expect(profile.body.data?.userId).toBe(userId);

    const forbidden = await callApi(`${userBase}/customers/someone-else`, {
      headers: authHeaders(),
    });
    expect(forbidden.status).toBe(403);

    const created = await callApi(`${userBase}/users/${userId}/addresses`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        line1: '12 Palm Street',
        city: 'Kochi',
        state: 'Kerala',
        country: 'India',
        postalCode: '682001',
        isDefault: true,
      }),
    });
    expect(created.status).toBe(200);
    expect(created.body.data?.isDefault).toBe(true);
    addressId = created.body.data.id;

    const one = await callApi(
      `${userBase}/users/${userId}/addresses/${addressId}`,
      { headers: authHeaders() },
    );
    expect(one.status).toBe(200);
    expect(one.body.data?.id).toBe(addressId);

    const list = await callApi(`${userBase}/users/${userId}/addresses`, {
      headers: authHeaders(),
    });
    expect(list.status).toBe(200);
    expect(list.body.data?.items?.map((item: { id: string }) => item.id)).toContain(
      addressId,
    );

    const other = await callApi(`${userBase}/users/someone-else/addresses`, {
      headers: authHeaders(),
    });
    expect(other.status).toBe(403);
  });

  it('creates a vehicle, lists types, and lists only owned vehicles', async () => {
    const types = await callApi(`${vehicleBase}/vehicle-types`, {
      headers: authHeaders(),
    });
    expect(types.status).toBe(200);
    expect(Array.isArray(types.body.data?.items)).toBe(true);
    expect(types.body.data.items).toEqual(
      expect.arrayContaining(['HATCHBACK', 'SEDAN', 'SUV']),
    );

    const created = await callApi(`${vehicleBase}/vehicles`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        userId: 'someone-else',
        registrationNumber: `KL07P${stamp.slice(-4)}`,
        vehicleType: 'HATCHBACK',
      }),
    });
    expect(created.status).toBe(200);
    expect(created.body.data?.userId).toBe(userId);
    expect(created.body.data?.defaultVehicle).toBe(true);
    vehicleId = created.body.data.id;

    const list = await callApi(`${vehicleBase}/vehicles`, {
      headers: authHeaders(),
    });
    expect(list.status).toBe(200);
    expect(list.body.data?.items?.map((item: { id: string }) => item.id)).toContain(
      vehicleId,
    );
    expect(
      list.body.data.items.every((item: { userId: string }) => item.userId === userId),
    ).toBe(true);
  });
});
