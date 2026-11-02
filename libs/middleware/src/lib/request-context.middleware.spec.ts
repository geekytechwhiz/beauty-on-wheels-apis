import { buildRequestContext } from './request-context.middleware';

describe('buildRequestContext authorizer phone', () => {
  it('copies the verified phone from authorizer context and ignores the body phone', () => {
    const request = buildRequestContext({
      body: {
        ownerDetails: { phoneNumber: '+910000000000', userId: 'attacker' },
        role: 'ADMIN',
        permissions: ['vendor:create'],
      },
      requestContext: {
        authorizer: {
          identityId: 'sub-1',
          userId: 'user-1',
          roles: '["REGISTRANT"]',
          permissions: '["vendor:register"]',
          phoneNumber: '+919811122233',
          phoneVerified: 'true',
        },
      },
    } as never);

    expect(request.context.authContext).toMatchObject({
      identityId: 'sub-1',
      userId: 'user-1',
      roles: ['REGISTRANT'],
      permissions: ['vendor:register'],
      phoneNumber: '+919811122233',
      phoneVerified: true,
    });
    expect(request.context.userContext?.userId).toBe('user-1');
    expect(request.body).toMatchObject({
      ownerDetails: { phoneNumber: '+910000000000' },
    });
  });

  it('keeps a customer authorizer context without inventing a phone', () => {
    const request = buildRequestContext({
      requestContext: {
        authorizer: {
          identityId: 'sub-1',
          userId: 'customer-1',
          roles: '["CUSTOMER"]',
          permissions: '[]',
        },
      },
    } as never);

    expect(request.context.authContext?.roles).toEqual(['CUSTOMER']);
    expect(request.context.authContext?.phoneNumber).toBeUndefined();
    expect(request.context.authContext?.phoneVerified).toBeUndefined();
  });
});
