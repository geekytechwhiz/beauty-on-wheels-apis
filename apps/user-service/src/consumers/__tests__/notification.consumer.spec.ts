import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../notification.consumer';

vi.mock('../../services/notification.delivery', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  sendSms: vi.fn().mockResolvedValue({ success: true }),
  sendPush: vi.fn().mockResolvedValue({ success: true }),
}));

const { sendEmail, sendSms } = require('../../services/notification.delivery');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notification.consumer', () => {
  it('should call sendEmail and sendSms for channels', async () => {
    const envelope = {
      eventType: 'NotificationRequested.v1',
      data: {
        userId: 'u1',
        email: 'a@b.com',
        phone: '9123456789',
        name: 'Test',
        channels: ['email', 'sms'],
        template: 'WELCOME',
        templateData: { foo: 'bar' },
      },
    };

    const event = { Records: [{ Sns: { Message: JSON.stringify(envelope) } }] } as any;
    const res = await handler(event, {} as any);
    expect(sendEmail).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalled();
    expect(res).toBeDefined();
  });
});
