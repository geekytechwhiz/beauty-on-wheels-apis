import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { assertCatalogAdmin } from './catalog-admin';

function request(partial: Record<string, unknown>): LambdaRequest {
  return {
    params: {},
    body: {},
    context: partial,
  } as unknown as LambdaRequest;
}

describe('assertCatalogAdmin', () => {
  it('rejects an unauthenticated caller', () => {
    expect(() => assertCatalogAdmin(request({}))).toThrow(UnauthorizedError);
  });

  it('rejects an authenticated caller who is not a catalog admin', () => {
    expect(() =>
      assertCatalogAdmin(
        request({
          authContext: {
            identityId: 'user-1',
            userId: 'user-1',
            roles: ['CUSTOMER'],
            permissions: [],
            claims: {},
          },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('allows catalog:write and the admin role', () => {
    expect(() =>
      assertCatalogAdmin(
        request({
          authContext: {
            identityId: 'admin-1',
            roles: [],
            permissions: ['catalog:write'],
            claims: {},
          },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertCatalogAdmin(
        request({
          authContext: {
            identityId: 'admin-1',
            roles: ['ADMIN'],
            permissions: [],
            claims: {},
          },
        }),
      ),
    ).not.toThrow();
  });
});
