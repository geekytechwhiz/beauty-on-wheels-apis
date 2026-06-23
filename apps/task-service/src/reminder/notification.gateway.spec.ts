import {
  getNotificationGateway,
  LogNotificationGateway,
  setNotificationGatewayForTests,
} from './notification.gateway';

describe('notification.gateway', () => {
  afterEach(() => {
    setNotificationGatewayForTests(undefined);
  });

  it('LogNotificationGateway resolves without error', async () => {
    const gateway = new LogNotificationGateway();
    await expect(
      gateway.sendReminder({
        runtimeTaskInstanceId: 'rtask-1',
        patientId: 'pat-1',
        orgId: 'org-1',
        channel: 'push',
        scheduledAt: Date.now() + 60_000,
        correlationId: 'corr-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('getNotificationGateway returns singleton', () => {
    const first = getNotificationGateway();
    const second = getNotificationGateway();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(LogNotificationGateway);
  });

  it('setNotificationGatewayForTests overrides singleton', async () => {
    const custom = { sendReminder: jest.fn().mockResolvedValue(undefined) };
    setNotificationGatewayForTests(custom);
    await getNotificationGateway().sendReminder({
      runtimeTaskInstanceId: 'rtask-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      channel: 'push',
      scheduledAt: 1,
    });
    expect(custom.sendReminder).toHaveBeenCalledTimes(1);
  });
});
