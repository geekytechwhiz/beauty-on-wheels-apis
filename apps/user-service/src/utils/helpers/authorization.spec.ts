import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import {
  assertAdminAccess,
  assertOwnerAdminOrService,
  assertOwnerOrAdmin,
  assertServiceOrAdmin,
} from './authorization';

function request(roles: string[] = [], userId?: string): LambdaRequest {
  return {
    params: {},
    context: {
      correlationId: 'corr',
      awsRequestId: 'req',
      logger: {},
      userContext: {
        ...(userId ? { userId } : {}),
        roles,
      },
    },
  } as unknown as LambdaRequest;
}

describe('user authorization', () => {
  it('allows the owner and an admin to write', () => {
    expect(assertOwnerOrAdmin(request(['customer'], 'user-1'), 'user-1')).toBe(
      'user-1',
    );
    expect(assertOwnerOrAdmin(request(['Admin'], 'admin-1'), 'user-1')).toBe(
      'admin-1',
    );
  });

  it('rejects a different customer', () => {
    expect(() =>
      assertOwnerOrAdmin(request(['customer'], 'user-2'), 'user-1'),
    ).toThrow(ForbiddenError);
  });

  it('allows a service principal to read and not to pass as admin', () => {
    expect(() =>
      assertOwnerAdminOrService(request(['service-principal']), 'user-1'),
    ).not.toThrow();
    expect(() => assertAdminAccess(request(['whatsapp'], 'worker'))).toThrow(
      ForbiddenError,
    );
  });

  it('requires a service principal or admin for phone lookup', () => {
    expect(() => assertServiceOrAdmin(request(['customer'], 'user-1'))).toThrow(
      ForbiddenError,
    );
    expect(() => assertServiceOrAdmin(request(['notification']))).not.toThrow();
    expect(() => assertServiceOrAdmin(request())).toThrow(UnauthorizedError);
  });
});
