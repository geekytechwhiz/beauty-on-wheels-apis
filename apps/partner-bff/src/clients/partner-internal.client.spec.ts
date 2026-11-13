import { LambdaClient } from '@aws-sdk/client-lambda';

import { LambdaPartnerInternalClient, type PartnerActor } from './partner-internal.client';

const actor: PartnerActor = { userId: 'user-1', vendorId: 'vendor-1', roles: ['manager'], permissions: [], correlationId: 'c-1' };

describe('LambdaPartnerInternalClient', () => {
  it('uses a direct Lambda invocation and never forwards an application Authorization token', async () => {
    const send = jest.fn(async () => ({ Payload: Buffer.from(JSON.stringify({ data: { timezone: 'Asia/Kolkata', days: [], issues: [], issuesAvailable: true, sourceAsOf: '2026-11-13T00:00:00.000Z' } })) }));
    const client = new LambdaPartnerInternalClient(
      { send } as unknown as LambdaClient,
      { operationalAccessFunction: 'vendor-access', vendorManagerReadFunction: 'vendor-read', bookingManagerReadFunction: 'booking-read' },
    );
    await client.readBooking(actor, 'overview', { dates: '2026-11-13' });
    const command = send.mock.calls[0][0];
    const payload = JSON.parse(Buffer.from(command.input.Payload).toString('utf8'));
    expect(command.input).toMatchObject({ FunctionName: 'booking-read', InvocationType: 'RequestResponse' });
    expect(command.input).not.toHaveProperty('Authorization');
    expect(payload).toEqual({ actor, action: 'overview', query: { dates: '2026-11-13' } });
    expect(JSON.stringify(command.input)).not.toContain('Bearer ');
  });

  it('maps a missing downstream function to a retryable dependency failure', async () => {
    const missing = Object.assign(new Error('Function not found'), { name: 'ResourceNotFoundException' });
    const client = new LambdaPartnerInternalClient(
      { send: jest.fn(async () => { throw missing; }) } as unknown as LambdaClient,
      { operationalAccessFunction: 'vendor-access', vendorManagerReadFunction: 'vendor-read', bookingManagerReadFunction: 'booking-read' },
    );
    await expect(client.readVendor(actor, { includeCrews: true })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', statusCode: 502, retryable: true });
  });

  it('returns Vendor crews with their point of contact from the data envelope', async () => {
    const crews = [{ crewId: 'crew-1', pointOfContact: { staffId: 'staff-1', name: 'Asha', phoneNumber: '+919800000000', source: 'firstActiveMember' } }];
    const send = jest.fn(async () => ({ Payload: Buffer.from(JSON.stringify({ data: { crews, sourceAsOf: '2026-11-13T00:00:00.000Z' } })) }));
    const client = new LambdaPartnerInternalClient(
      { send } as unknown as LambdaClient,
      { operationalAccessFunction: 'vendor-access', vendorManagerReadFunction: 'vendor-read', bookingManagerReadFunction: 'booking-read' },
    );
    await expect(client.readVendor(actor, { includeCrews: true })).resolves.toEqual({ crews, sourceAsOf: '2026-11-13T00:00:00.000Z' });
    expect(JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString('utf8'))).toEqual({ actor, includeCrews: true });
  });

  it('fails closed when the required internal function is not configured', async () => {
    const client = new LambdaPartnerInternalClient({ send: jest.fn() } as unknown as LambdaClient, {
      operationalAccessFunction: '', vendorManagerReadFunction: '', bookingManagerReadFunction: '',
    });
    await expect(client.resolveOperationalAccess('user-1')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', statusCode: 502 });
  });
});
