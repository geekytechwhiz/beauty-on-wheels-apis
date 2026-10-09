import { applyApplicationRoles, type PreTokenGenerationEvent } from './pre-token-generation';

function event(overrides: Partial<PreTokenGenerationEvent> = {}): PreTokenGenerationEvent {
  return {
    version: '2',
    triggerSource: 'TokenGeneration_Authentication',
    userName: 'bow_user',
    request: {
      userAttributes: {
        sub: 'cognito-sub-1',
        email: 'ada@example.com',
      },
      scopes: ['aws.cognito.signin.user.admin'],
    },
    response: {},
    ...overrides,
  };
}

describe('applyApplicationRoles', () => {
  it('adds persisted userType, primary role, and every role to an access token', async () => {
    const result = await applyApplicationRoles(event(), async () => ({
      identityId: 'cognito-sub-1',
      userType: 'VENDOR',
      roles: ['VENDOR'],
    }));

    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            identityId: 'cognito-sub-1',
            userType: 'VENDOR',
            role: 'VENDOR',
            roles: ['VENDOR'],
          },
        },
      },
    });
  });

  it('keeps every persisted role and selects ADMIN as the compatible scalar role', async () => {
    const result = await applyApplicationRoles(event(), async () => ({
      identityId: 'cognito-sub-1',
      userType: 'CUSTOMER',
      roles: ['CUSTOMER', 'VENDOR', 'ADMIN'],
    }));
    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            identityId: 'cognito-sub-1',
            userType: 'CUSTOMER',
            role: 'ADMIN',
            roles: ['CUSTOMER', 'VENDOR', 'ADMIN'],
          },
        },
      },
    });
  });

  it('adds application roles to the access token and keeps sub', async () => {
    const source = event();
    const result = await applyApplicationRoles(source, async () => [
      'CUSTOMER',
      'VENDOR',
    ]);

    expect(result.request?.userAttributes?.sub).toBe('cognito-sub-1');
    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            roles: ['CUSTOMER', 'VENDOR'],
          },
        },
      },
    });
    expect(JSON.stringify(result.response)).not.toContain('aws.cognito.signin.user.admin');
    expect(JSON.stringify(result.response)).not.toContain('onboarding');
    expect(JSON.stringify(result.response)).not.toContain('email');
  });

  it('uses the same access-token claim on refresh', async () => {
    const result = await applyApplicationRoles(
      event({ triggerSource: 'TokenGeneration_RefreshTokens' }),
      async () => ['CUSTOMER'],
    );
    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            roles: ['CUSTOMER'],
          },
        },
      },
    });
  });

  it('does not copy onboarding status or scope into the access token', async () => {
    const result = await applyApplicationRoles(event(), async () => ['ADMIN']);
    const serialized = JSON.stringify(result.response);
    for (const status of ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']) {
      expect(serialized).not.toContain(status);
    }
    expect(serialized).not.toContain('scope');
  });

  it('deduplicates roles and drops values that are not application roles', async () => {
    const result = await applyApplicationRoles(event(), async () => [
      'VENDOR',
      'CUSTOMER',
      'CUSTOMER',
      'user',
      'aws.cognito.signin.user.admin',
    ]);
    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            roles: ['CUSTOMER', 'VENDOR'],
          },
        },
      },
    });
  });

  it('keeps an existing ID-token override and does not copy roles onto it', async () => {
    const result = await applyApplicationRoles(
      event({
        response: {
          claimsAndScopeOverrideDetails: {
            idTokenGeneration: {
              claimsToAddOrOverride: { locale: 'en' },
            },
            accessTokenGeneration: {
              claimsToAddOrOverride: { locale: 'en' },
              scopesToSuppress: ['unused'],
            },
          },
        },
      }),
      async () => ['ADMIN'],
    );
    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        idTokenGeneration: {
          claimsToAddOrOverride: { locale: 'en' },
        },
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            locale: 'en',
            roles: ['ADMIN'],
          },
          scopesToSuppress: ['unused'],
        },
      },
    });
    const idToken = (
      result.response as {
        claimsAndScopeOverrideDetails: {
          idTokenGeneration: { claimsToAddOrOverride: Record<string, unknown> };
        };
      }
    ).claimsAndScopeOverrideDetails.idTokenGeneration.claimsToAddOrOverride;
    expect(idToken).not.toHaveProperty('roles');
  });

  it('adds a single admin role', async () => {
    const result = await applyApplicationRoles(event(), async () => ['ADMIN']);
    expect(result.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            roles: ['ADMIN'],
          },
        },
      },
    });
  });

  it('leaves the token unchanged when the user has no explicit application role', async () => {
    const source = event();
    const result = await applyApplicationRoles(source, async () => []);
    expect(result).toBe(source);
    expect(result.response).toEqual({});
  });

  it('leaves the token unchanged when sub is missing', async () => {
    const source = event({
      request: { userAttributes: {}, scopes: ['openid'] },
    });
    const resolveRoles = jest.fn();
    const result = await applyApplicationRoles(source, resolveRoles);
    expect(result).toBe(source);
    expect(resolveRoles).not.toHaveBeenCalled();
  });

  it('does not fail token generation when role lookup throws', async () => {
    const source = event();
    const result = await applyApplicationRoles(source, async () => {
      throw new Error('dynamo unavailable');
    });
    expect(result).toBe(source);
    expect(JSON.stringify(result.response)).not.toContain('ADMIN');
    expect(JSON.stringify(result.response)).not.toContain('roles');
  });
});
