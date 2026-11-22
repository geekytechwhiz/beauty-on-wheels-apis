import {
  APPLICATION_ROLE,
  effectiveAccessTokenRoles,
  parseAccessTokenRolesClaim,
  primaryApplicationRole,
  resolveApplicationRoles,
} from './application-roles';

describe('resolveApplicationRoles', () => {
  it('returns explicit application roles and drops the generic user role', () => {
    expect(resolveApplicationRoles(['user', 'VENDOR', 'customer'])).toEqual([
      APPLICATION_ROLE.CUSTOMER,
      APPLICATION_ROLE.VENDOR,
    ]);
  });

  it('returns a stable order for combined customer and vendor roles', () => {
    expect(resolveApplicationRoles(['VENDOR', 'CUSTOMER'])).toEqual([
      'CUSTOMER',
      'VENDOR',
    ]);
  });

  it('recognizes REGISTRANT and does not collapse it into VENDOR', () => {
    expect(resolveApplicationRoles(['REGISTRANT', 'vendor'])).toEqual([
      'REGISTRANT',
      'VENDOR',
    ]);
    expect(resolveApplicationRoles(['PENDING_VENDOR', 'pending_vendor'])).toEqual([]);
  });

  it('recognizes ROOT, STAFF, BUDDY, and GUEST', () => {
    expect(resolveApplicationRoles(['guest', 'ROOT', 'staff', 'buddy'])).toEqual([
      'GUEST',
      'BUDDY',
      'STAFF',
      'ROOT',
    ]);
  });

  it('returns an empty list when the user only has the generic role', () => {
    expect(resolveApplicationRoles(['user', 'USER', ''])).toEqual([]);
  });

  it('does not treat Cognito scope strings as application roles', () => {
    expect(
      resolveApplicationRoles(['aws.cognito.signin.user.admin', 'openid']),
    ).toEqual([]);
  });

  it('does not treat vendor onboarding status as an application role', () => {
    expect(
      resolveApplicationRoles([
        'PENDING',
        'UNDER_REVIEW',
        'APPROVED',
        'REJECTED',
        'PENDING_REVIEW',
      ]),
    ).toEqual([]);
  });
});

describe('primaryApplicationRole', () => {
  it('prefers STAFF (platform) over BUDDY when both are present', () => {
    expect(
      primaryApplicationRole([
        APPLICATION_ROLE.CUSTOMER,
        APPLICATION_ROLE.BUDDY,
        APPLICATION_ROLE.STAFF,
      ]),
    ).toBe(APPLICATION_ROLE.STAFF);
  });

  it('selects BUDDY ahead of CUSTOMER', () => {
    expect(
      primaryApplicationRole([
        APPLICATION_ROLE.CUSTOMER,
        APPLICATION_ROLE.BUDDY,
      ]),
    ).toBe(APPLICATION_ROLE.BUDDY);
  });
});

describe('parseAccessTokenRolesClaim', () => {
  it('treats a missing claim as a legacy token', () => {
    expect(parseAccessTokenRolesClaim(undefined)).toEqual({
      ok: true,
      roles: undefined,
    });
  });

  it('parses an array claim', () => {
    expect(parseAccessTokenRolesClaim(['ADMIN'])).toEqual({
      ok: true,
      roles: ['ADMIN'],
    });
  });

  it('parses a JSON array string', () => {
    expect(parseAccessTokenRolesClaim('["CUSTOMER","VENDOR"]')).toEqual({
      ok: true,
      roles: ['CUSTOMER', 'VENDOR'],
    });
  });

  it('rejects profile or onboarding objects', () => {
    expect(parseAccessTokenRolesClaim({ onboardingStatus: 'PENDING' })).toEqual({
      ok: false,
    });
    expect(
      parseAccessTokenRolesClaim('[{"status":"ACTIVE"}]'),
    ).toEqual({ ok: false });
  });
});

describe('effectiveAccessTokenRoles', () => {
  it('drops a revoked role before the access token expires', () => {
    expect(
      effectiveAccessTokenRoles({
        tokenRoles: ['CUSTOMER', 'VENDOR'],
        directoryRoleIds: ['CUSTOMER'],
      }),
    ).toEqual(['CUSTOMER']);
  });

  it('does not grant a role that is only on the directory until the next token', () => {
    expect(
      effectiveAccessTokenRoles({
        tokenRoles: ['CUSTOMER'],
        directoryRoleIds: ['CUSTOMER', 'VENDOR'],
      }),
    ).toEqual(['CUSTOMER']);
  });

  it('does not keep a token role the directory no longer stores', () => {
    expect(
      effectiveAccessTokenRoles({
        tokenRoles: ['ADMIN'],
        directoryRoleIds: ['user'],
        profileRoleId: 'user',
      }),
    ).toEqual([]);
  });

  it('grants no roles when the token has no application roles claim', () => {
    expect(
      effectiveAccessTokenRoles({
        tokenRoles: undefined,
        directoryRoleIds: ['user'],
      }),
    ).toEqual([]);
  });
});
