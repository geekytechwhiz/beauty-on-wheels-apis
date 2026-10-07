import {
  APPLICATION_ROLE,
  parseAccessTokenRolesClaim,
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
