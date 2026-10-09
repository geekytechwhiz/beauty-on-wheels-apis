import { APPLICATION_ROLE } from '@api-hub/authentication-core';

import { applyApplicationRoles } from './pre-token-generation';
import {
  backfillApplicationRoles,
  decideAdminRoleChange,
  planApplicationRoleBackfill,
  prepareApplicationRolesForToken,
  initializeApplicationRoleForNewIdentity,
  type ApplicationRoleRepository,
} from './application-role-assignment';
import { applyVendorApprovalRole } from './vendor-approval-role';

function memoryRepository(
  users: Array<{ userId: string; roleId?: string }>,
): ApplicationRoleRepository & {
  listUserMetaPage: NonNullable<ApplicationRoleRepository['listUserMetaPage']>;
  mappings: Map<string, Set<string>>;
} {
  const mappings = new Map<string, Set<string>>();
  return {
    mappings,
    async getUserRoles(userId: string) {
      return [...(mappings.get(userId) ?? [])];
    },
    async ensureUserRoleMapping(userId: string, roleId: string) {
      const current = mappings.get(userId) ?? new Set<string>();
      if (current.has(roleId)) {
        return 'exists';
      }
      current.add(roleId);
      mappings.set(userId, current);
      return 'created';
    },
    async deleteUserRoleMapping(userId: string, roleId: string) {
      const current = mappings.get(userId);
      if (!current?.has(roleId)) {
        return 'missing';
      }
      current.delete(roleId);
      return 'deleted';
    },
    async listUserMetaPage() {
      return { users };
    },
  };
}

describe('planApplicationRoleBackfill', () => {
  it('assigns CUSTOMER when the user has no application role', () => {
    expect(
      planApplicationRoleBackfill({
        mappedRoleIds: ['user'],
        profileRoleId: 'user',
      }),
    ).toEqual({ assignCustomer: true, preserve: [] });
  });

  it('does not assign CUSTOMER again when the mapping exists', () => {
    expect(
      planApplicationRoleBackfill({
        mappedRoleIds: ['CUSTOMER'],
        profileRoleId: 'user',
      }),
    ).toEqual({ assignCustomer: false, preserve: [] });
  });

  it('does not overwrite VENDOR or ADMIN', () => {
    expect(
      planApplicationRoleBackfill({
        mappedRoleIds: [],
        profileRoleId: 'ADMIN',
      }),
    ).toEqual({ assignCustomer: false, preserve: ['ADMIN'] });
    expect(
      planApplicationRoleBackfill({
        mappedRoleIds: ['VENDOR'],
        profileRoleId: 'user',
      }),
    ).toEqual({ assignCustomer: false, preserve: [] });
  });
});

describe('application role token flow', () => {
  it('initializes a VENDOR role only while a new identity is created', async () => {
    const repository = memoryRepository([]);
    await initializeApplicationRoleForNewIdentity(repository, {
      userId: 'u-vendor',
      userType: 'VENDOR',
    });
    expect(repository.mappings.get('u-vendor')).toEqual(new Set(['VENDOR']));
  });

  it('creates a CUSTOMER mapping for a new registration and puts it on the access token', async () => {
    const repository = memoryRepository([]);
    await prepareApplicationRolesForToken(repository, {
      userId: 'u-new',
      roleId: 'user',
    });
    expect(repository.mappings.get('u-new')).toEqual(new Set(['CUSTOMER']));

    const token = await applyApplicationRoles(
      {
        version: '2',
        triggerSource: 'TokenGeneration_Authentication',
        request: {
          userAttributes: { sub: 'cognito-sub-1' },
          scopes: ['aws.cognito.signin.user.admin'],
        },
      },
      async () => [...(repository.mappings.get('u-new') ?? [])],
    );

    expect(token.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: { roles: ['CUSTOMER'] },
        },
      },
    });
    expect(JSON.stringify(token.response)).not.toContain('aws.cognito.signin.user.admin');
    expect(JSON.stringify(token.response)).not.toContain('user');
  });

  it('puts the latest roles on a refreshed access token', async () => {
    const repository = memoryRepository([]);
    repository.mappings.set('u-1', new Set(['CUSTOMER', 'VENDOR']));
    const token = await applyApplicationRoles(
      {
        version: '2',
        triggerSource: 'TokenGeneration_RefreshTokens',
        request: { userAttributes: { sub: 'cognito-sub-1' }, scopes: ['openid'] },
      },
      async () => [...(repository.mappings.get('u-1') ?? [])],
    );
    expect(token.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: { roles: ['CUSTOMER', 'VENDOR'] },
        },
      },
    });
  });

  it('adds VENDOR without removing CUSTOMER and keeps onboarding status out of the token', async () => {
    const repository = memoryRepository([]);
    repository.mappings.set('u-1', new Set(['CUSTOMER']));
    await applyVendorApprovalRole(
      {
        newStatus: 'ACTIVE',
        ownerUserId: 'u-1',
        onboardingStatus: 'PENDING_REVIEW',
      },
      repository,
    );

    const roles = [...(repository.mappings.get('u-1') ?? [])].sort();
    expect(roles).toEqual(['CUSTOMER', 'VENDOR']);

    const token = await applyApplicationRoles(
      {
        triggerSource: 'TokenGeneration_Authentication',
        request: { userAttributes: { sub: 'cognito-sub-1' } },
      },
      async () => ['VENDOR', 'CUSTOMER'],
    );
    const claims = JSON.stringify(token.response);
    expect(claims).toContain('CUSTOMER');
    expect(claims).toContain('VENDOR');
    for (const status of ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PENDING_REVIEW']) {
      expect(claims).not.toContain(status);
    }
  });

  it('does not treat onboarding status or Cognito scope as an application role', async () => {
    expect(
      await applyVendorApprovalRole(
        { newStatus: 'PENDING_VERIFICATION', onboardingStatus: 'APPROVED', ownerUserId: 'u-1' },
        memoryRepository([]),
      ),
    ).toBe('skipped');
  });

  it('removes VENDOR on suspension and keeps CUSTOMER', async () => {
    const repository = memoryRepository([]);
    repository.mappings.set('u-1', new Set(['CUSTOMER', 'VENDOR']));
    await expect(
      applyVendorApprovalRole(
        {
          newStatus: 'SUSPENDED',
          ownerUserId: 'u-1',
          onboardingStatus: 'COMPLETED',
        },
        repository,
      ),
    ).resolves.toBe('revoked');
    expect([...(repository.mappings.get('u-1') ?? [])]).toEqual(['CUSTOMER']);

    const token = await applyApplicationRoles(
      {
        triggerSource: 'TokenGeneration_RefreshTokens',
        request: { userAttributes: { sub: 'cognito-sub-1' } },
      },
      async () => [...(repository.mappings.get('u-1') ?? [])],
    );
    expect(token.response).toEqual({
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: { roles: ['CUSTOMER'] },
        },
      },
    });
  });
});

describe('decideAdminRoleChange', () => {
  it('allows an ADMIN caller to assign ADMIN', () => {
    expect(
      decideAdminRoleChange({
        callerRoles: ['CUSTOMER', 'ADMIN'],
        requestedRole: 'ADMIN',
      }),
    ).toEqual({ ok: true, role: 'ADMIN' });
  });

  it('rejects a caller that does not already have ADMIN', () => {
    expect(
      decideAdminRoleChange({
        callerRoles: ['CUSTOMER', 'VENDOR'],
        requestedRole: 'ADMIN',
      }),
    ).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('rejects VENDOR and CUSTOMER assignment through the admin operation', () => {
    expect(
      decideAdminRoleChange({
        callerRoles: ['ADMIN'],
        requestedRole: 'VENDOR',
      }),
    ).toEqual({ ok: false, reason: 'unsupported_role' });
    expect(
      decideAdminRoleChange({
        callerRoles: ['ADMIN'],
        requestedRole: 'CUSTOMER',
      }),
    ).toEqual({ ok: false, reason: 'unsupported_role' });
  });
});

describe('backfillApplicationRoles', () => {
  it('assigns CUSTOMER once and leaves VENDOR and ADMIN in place', async () => {
    const repository = memoryRepository([
      { userId: 'legacy', roleId: 'user' },
      { userId: 'vendor', roleId: 'VENDOR' },
      { userId: 'admin', roleId: 'admin' },
      { userId: 'already', roleId: 'user' },
    ]);
    repository.mappings.set('already', new Set([APPLICATION_ROLE.CUSTOMER]));
    repository.mappings.set('vendor', new Set([APPLICATION_ROLE.VENDOR]));

    const first = await backfillApplicationRoles(repository);
    const second = await backfillApplicationRoles(repository);

    expect(first).toEqual({
      scanned: 4,
      assignedCustomer: 1,
      preserved: 1,
      unchanged: 2,
    });
    expect(second).toEqual({
      scanned: 4,
      assignedCustomer: 0,
      preserved: 0,
      unchanged: 4,
    });
    expect([...(repository.mappings.get('legacy') ?? [])]).toEqual(['CUSTOMER']);
    expect([...(repository.mappings.get('vendor') ?? [])]).toEqual(['VENDOR']);
    expect([...(repository.mappings.get('admin') ?? [])]).toEqual(['ADMIN']);
    expect([...(repository.mappings.get('already') ?? [])]).toEqual(['CUSTOMER']);
  });
});
