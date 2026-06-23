import {
  EnvDefaultQuietHoursProvider,
  getQuietHoursProvider,
  setQuietHoursProviderForTests,
} from './quiet-hours.provider';

describe('quiet-hours.provider', () => {
  afterEach(() => {
    setQuietHoursProviderForTests(undefined);
  });

  it('EnvDefaultQuietHoursProvider returns null', async () => {
    const provider = new EnvDefaultQuietHoursProvider();
    await expect(provider.getForPatient({ patientId: 'pat-1', orgId: 'org-1' })).resolves.toBeNull();
  });

  it('getQuietHoursProvider returns singleton EnvDefaultQuietHoursProvider', () => {
    const first = getQuietHoursProvider();
    const second = getQuietHoursProvider();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(EnvDefaultQuietHoursProvider);
  });

  it('setQuietHoursProviderForTests overrides singleton', async () => {
    const custom = {
      getForPatient: jest.fn().mockResolvedValue({
        timezone: 'UTC',
        startLocalMinutes: 22 * 60,
        endLocalMinutes: 7 * 60,
      }),
    };
    setQuietHoursProviderForTests(custom);
    const resolved = await getQuietHoursProvider().getForPatient({ patientId: 'p', orgId: 'o' });
    expect(custom.getForPatient).toHaveBeenCalledWith({ patientId: 'p', orgId: 'o' });
    expect(resolved?.timezone).toBe('UTC');
  });
});
