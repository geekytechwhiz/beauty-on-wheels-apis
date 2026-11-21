import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import {
  assertAdminAccess,
  assertCanCreateVendor,
  assertVendorAccess,
  assertVendorAction,
} from './authorization';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    body: overrides.body,
    event: overrides.event,
    context: {
      userContext: {},
      ...(overrides.context as object),
    },
  } as unknown as LambdaRequest;
}

const vendor = { vendorId: 'vendor-1', ownerUserId: 'user-1' };

describe('vendor creation authorization', () => {
  const caller = (roles: string[]) =>
    request({
      context: {
        authContext: {
          identityId: 'sub-1',
          userId: 'user-1',
          roles,
          permissions: [],
        },
      },
    });

  it('allows a stored VENDOR role', () => {
    expect(assertCanCreateVendor(caller(['VENDOR']))).toBe('user-1');
  });

  it('separates a customer from a vendor owner', () => {
    expect(() => assertCanCreateVendor(caller(['CUSTOMER']))).toThrow(ForbiddenError);
  });

  const registrant = (extra: Record<string, unknown> = {}) =>
    request({
      body: extra.body,
      context: {
        authContext: {
          identityId: 'sub-1',
          userId: 'user-1',
          roles: ['REGISTRANT'],
          permissions: [],
          phoneVerified: true,
          phoneNumber: '+919876543210',
          claims: {},
          ...(extra.auth as object),
        },
        userContext: {
          userId: 'user-1',
          roles: ['ADMIN'],
          permissions: [],
        },
      },
    });

  it('allows REGISTRANT with a verified phone', () => {
    expect(assertCanCreateVendor(registrant())).toBe('user-1');
  });

  it('denies an unverified REGISTRANT phone', () => {
    expect(() =>
      assertCanCreateVendor(registrant({ auth: { phoneVerified: false } })),
    ).toThrow(ForbiddenError);
  });

  it('reports a missing verified phone instead of accepting one from the body', () => {
    expect(() =>
      assertCanCreateVendor(
        registrant({
          auth: { phoneNumber: undefined },
          body: { ownerDetails: { phoneNumber: '+910000000000' } },
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'VERIFIED_PHONE_UNAVAILABLE' }),
    );
  });

  it('does not let a userContext role widen REGISTRANT for vendor resources', () => {
    expect(() =>
      assertVendorAccess(registrant(), vendor),
    ).toThrow(ForbiddenError);
  });

  it('denies REGISTRANT on an owned vendor profile, staff action, and admin route', () => {
    const callerRequest = registrant();
    expect(() => assertVendorAccess(callerRequest, vendor)).toThrow(ForbiddenError);
    expect(() =>
      assertVendorAction(callerRequest, vendor, 'staff:manage'),
    ).toThrow(ForbiddenError);
    expect(() => assertAdminAccess(callerRequest)).toThrow(ForbiddenError);
  });

  it('does not treat a role name that contains vendor as VENDOR', () => {
    expect(() => assertCanCreateVendor(caller(['VENDOR_REGISTRANT']))).toThrow(ForbiddenError);
    expect(() => assertCanCreateVendor(caller(['SUPER_VENDOR']))).toThrow(ForbiddenError);
  });

  it('does not accept userType from the request as a role', () => {
    expect(() =>
      assertCanCreateVendor(
        request({
          body: { userType: 'VENDOR' },
          context: {
            authContext: {
              identityId: 'sub-1',
              userId: 'user-1',
              roles: ['CUSTOMER'],
              permissions: [],
              claims: { userType: 'VENDOR' },
            },
          },
        }),
      ),
    ).toThrow(ForbiddenError);
  });
});

describe('vendor access helpers with API Gateway authorizer context', () => {
  it('rejects unauthenticated vendor access', () => {
    expect(() => assertVendorAccess(request(), vendor)).toThrow(UnauthorizedError);
  });

  it('does not trust X-User-Id as the caller identity', () => {
    expect(() =>
      assertVendorAccess(
        request({
          event: { headers: { 'X-User-Id': 'postman-user' } },
        }),
        vendor,
      ),
    ).toThrow(UnauthorizedError);
  });

  it('does not treat Cognito identityId as the application user id', () => {
    expect(() =>
      assertVendorAccess(
        request({
          context: {
            authContext: {
              identityId: 'cognito-sub-1',
              roles: [],
              permissions: [],
              claims: {},
            },
            userContext: { userId: 'cognito-sub-1', identityId: 'cognito-sub-1' },
          },
        }),
        vendor,
      ),
    ).toThrow(UnauthorizedError);
  });

  it('forbids a caller who does not own the vendor', () => {
    expect(() =>
      assertVendorAccess(
        request({ context: { userContext: { userId: 'other-user' } } }),
        vendor,
      ),
    ).toThrow(ForbiddenError);
  });

  it('allows the vendor owner from authorizer context', () => {
    expect(
      assertVendorAccess(
        request({
          context: {
            authContext: { identityId: 'sub-1', userId: 'user-1', roles: [], permissions: [] },
            userContext: { userId: 'user-1', identityId: 'sub-1' },
          },
        }),
        vendor,
      ),
    ).toBe('user-1');
  });

  it('rejects unauthenticated admin access', () => {
    expect(() => assertAdminAccess(request())).toThrow(UnauthorizedError);
  });

  it('requires an admin role when a caller is authenticated', () => {
    expect(() =>
      assertAdminAccess(
        request({ context: { userContext: { userId: 'user-1' } } }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('treats case-insensitive admin and root roles as administrator access', () => {
    expect(
      assertAdminAccess(
        request({
          context: { userContext: { userId: 'admin-1', roles: ['Admin'] } },
        }),
      ),
    ).toBe('admin-1');
    expect(
      assertAdminAccess(
        request({
          context: { userContext: { userId: 'root-1', roles: ['ROOT'] } },
        }),
      ),
    ).toBe('root-1');
  });

  it('lets an active STAFF member read only view-level actions', () => {
    const staffRequest = request({
      context: {
        authContext: {
          identityId: 'sub-2',
          userId: 'staff-user',
          roles: ['STAFF'],
          permissions: [],
          claims: {},
        },
        userContext: { userId: 'staff-user' },
      },
    });
    expect(assertVendorAction(
      staffRequest,
      vendor,
      'staff:view',
      { vendorId: 'vendor-1', status: 'ACTIVE' },
    )).toBe('staff-user');
    expect(() => assertVendorAction(
      staffRequest,
      vendor,
      'staff:manage',
      { vendorId: 'vendor-1', status: 'ACTIVE' },
    )).toThrow(ForbiddenError);
  });

  it('denies staff view for an inactive membership or another vendor', () => {
    const staffRequest = request({
      context: {
        authContext: {
          identityId: 'sub-2',
          userId: 'staff-user',
          roles: ['STAFF'],
          permissions: [],
          claims: {},
        },
        userContext: { userId: 'staff-user' },
      },
    });
    expect(() => assertVendorAction(
      staffRequest,
      vendor,
      'crew:view',
      { vendorId: 'vendor-1', status: 'INACTIVE' },
    )).toThrow(ForbiddenError);
    expect(() => assertVendorAction(
      staffRequest,
      vendor,
      'crew:view',
      { vendorId: 'vendor-2', status: 'ACTIVE' },
    )).toThrow(ForbiddenError);
  });

  it('allows an admin caller to access a vendor they do not own', () => {
    expect(
      assertVendorAccess(
        request({
          context: { userContext: { userId: 'admin-1', roles: ['ADMIN'] } },
        }),
        vendor,
      ),
    ).toBe('admin-1');
  });
});
