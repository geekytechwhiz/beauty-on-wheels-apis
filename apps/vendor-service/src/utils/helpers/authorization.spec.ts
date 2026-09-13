import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import {
  assertAdminAccess,
  assertVendorAccess,
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

  it('treats case-insensitive admin roles as administrator access', () => {
    expect(
      assertAdminAccess(
        request({
          context: { userContext: { userId: 'admin-1', roles: ['Admin'] } },
        }),
      ),
    ).toBe('admin-1');
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
