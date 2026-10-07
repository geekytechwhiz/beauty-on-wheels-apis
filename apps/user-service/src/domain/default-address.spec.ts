import {
  planCreateDefault,
  planDeleteDefault,
  planUpdateDefault,
} from './default-address';

describe('default address rules', () => {
  it('makes the first address the default', () => {
    expect(
      planCreateDefault({
        addressId: 'addr-1',
        active: [],
      }),
    ).toEqual({
      isDefault: true,
      defaultAddressId: 'addr-1',
    });
  });

  it('replaces the current default when requested', () => {
    expect(
      planCreateDefault({
        addressId: 'addr-2',
        requestedDefault: true,
        active: [{ addressId: 'addr-1', isDefault: true, updatedAt: '2026-01-01T00:00:00.000Z' }],
        currentDefaultAddressId: 'addr-1',
      }).clearAddressId,
    ).toBe('addr-1');
  });

  it('keeps the only address as the default when a caller tries to clear it', () => {
    expect(
      planUpdateDefault({
        addressId: 'addr-1',
        wasDefault: true,
        requestedDefault: false,
        activeOthers: [],
        currentDefaultAddressId: 'addr-1',
      }),
    ).toMatchObject({
      isDefault: true,
      defaultAddressId: 'addr-1',
    });
  });

  it('promotes the latest remaining address when the default is deleted', () => {
    expect(
      planDeleteDefault({
        wasDefault: true,
        activeOthers: [
          { addressId: 'older', isDefault: false, updatedAt: '2026-01-01T00:00:00.000Z' },
          { addressId: 'newer', isDefault: false, updatedAt: '2026-02-01T00:00:00.000Z' },
        ],
        currentDefaultAddressId: 'addr-1',
      }),
    ).toMatchObject({
      promoteAddressId: 'newer',
      defaultAddressId: 'newer',
    });
  });
});
