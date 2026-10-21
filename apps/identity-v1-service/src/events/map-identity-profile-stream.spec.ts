import { mapIdentityProfileInsertStreamRecord } from './map-identity-profile-stream';

function record(overrides: Record<string, unknown> = {}) {
  return {
    eventID: 'stream-1', eventName: 'INSERT',
    dynamodb: { NewImage: {
      PK: { S: 'USER#u-1' }, SK: { S: 'PROFILE' }, entityType: { S: 'Profile' },
      identityId: { S: 'identity-1' }, createdAt: { S: '2026-10-19T00:00:00.000Z' },
      userProvisioning: { M: { status: { S: 'PENDING' } } }, ...overrides,
    } },
  };
}

describe('mapIdentityProfileInsertStreamRecord', () => {
  it('maps only a pending identity PROFILE insertion', () => {
    expect(mapIdentityProfileInsertStreamRecord(record())).toMatchObject({
      eventType: 'Identity.Registered',
      payload: { identityId: 'identity-1', userId: 'u-1' },
    });
  });

  it.each([
    record({ SK: { S: 'META' } }),
    record({ entityType: { S: 'Role' } }),
    { ...record(), eventName: 'MODIFY' },
    record({ userProvisioning: { M: { status: { S: 'LINKED' } } } }),
  ])('rejects non-registration stream records', (input) => {
    expect(() => mapIdentityProfileInsertStreamRecord(input)).toThrow();
  });
});
