import {
  AUTH_KIND,
  INTERNAL_SERVICE_PRINCIPAL,
  INTERNAL_SERVICE_ROLE,
  isInternalServiceAuth,
  matchesInternalServiceToken,
  readConfiguredInternalServiceToken,
  toInternalServiceAuthorizerContext,
} from './internal-service-auth';

describe('internal-service-auth', () => {
  it('reads a configured internal token from the environment', () => {
    expect(
      readConfiguredInternalServiceToken({
        INTERNAL_SERVICE_TOKEN: '  secret-token  ',
      } as NodeJS.ProcessEnv),
    ).toBe('secret-token');
    expect(readConfiguredInternalServiceToken({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('matches bearer and raw tokens with constant-time equality', () => {
    expect(matchesInternalServiceToken('Bearer abcdefgh', 'abcdefgh')).toBe(true);
    expect(matchesInternalServiceToken('abcdefgh', 'abcdefgh')).toBe(true);
    expect(matchesInternalServiceToken('Bearer wrongtok', 'abcdefgh')).toBe(false);
    expect(matchesInternalServiceToken('Bearer abcdefgh', undefined)).toBe(false);
    expect(matchesInternalServiceToken(undefined, 'abcdefgh')).toBe(false);
  });

  it('builds an INTERNAL authorizer context', () => {
    expect(toInternalServiceAuthorizerContext()).toEqual({
      identityId: INTERNAL_SERVICE_PRINCIPAL,
      roles: JSON.stringify([INTERNAL_SERVICE_ROLE]),
      permissions: '[]',
      authKind: AUTH_KIND.INTERNAL,
    });
  });

  it('detects internal service auth from identity or role', () => {
    expect(
      isInternalServiceAuth({
        identityId: INTERNAL_SERVICE_PRINCIPAL,
        roles: [],
      }),
    ).toBe(true);
    expect(
      isInternalServiceAuth({
        identityId: 'user-1',
        roles: [INTERNAL_SERVICE_ROLE],
      }),
    ).toBe(true);
    expect(
      isInternalServiceAuth({
        identityId: 'user-1',
        roles: ['VENDOR'],
      }),
    ).toBe(false);
  });
});
