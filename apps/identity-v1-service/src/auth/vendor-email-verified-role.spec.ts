import { applyVendorEmailVerifiedRole } from './vendor-email-verified-role';

describe('applyVendorEmailVerifiedRole', () => {
  it('adds VENDOR without replacing CUSTOMER and is idempotent', async () => {
    const roles = new Set(['CUSTOMER']);
    const repository = {
      getUserRoles: jest.fn(async () => [...roles]),
      ensureUserRoleMapping: jest.fn(async (_userId: string, role: string) => {
        if (roles.has(role)) return 'exists' as const;
        roles.add(role);
        return 'created' as const;
      }),
      deleteUserRoleMapping: jest.fn(),
    };

    await expect(applyVendorEmailVerifiedRole({
      userId: 'user-1', vendorId: 'vendor-1', emailVerified: true,
    }, repository)).resolves.toBe('created');
    await expect(applyVendorEmailVerifiedRole({
      userId: 'user-1', vendorId: 'vendor-1', emailVerified: true,
    }, repository)).resolves.toBe('exists');
    expect([...roles].sort()).toEqual(['CUSTOMER', 'VENDOR']);
  });
});
