import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before importing consumer to avoid module resolution errors
vi.mock('@api-hub/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
  serializeError: vi.fn((err) => ({ message: err.message, stack: err.stack })),
}));

// Mock AWS secrets manager so consumer imports that cause delivery to load safely
vi.mock('@aws-sdk/client-secrets-manager', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-secrets-manager');
  class MockSecretsManagerClient {
    constructor() {}
    async send() {
      return { SecretString: JSON.stringify({ EMAIL_API_URL: 'https://email.test', AUTHORIZATION_KEY: 'auth', SMS_API_URL: 'https://sms.test', DLT_COTENT_ID: 'dlt-123' }) };
    }
  }
  class MockGetSecretValueCommand { constructor() {} }
  return {
    ...actual,
    SecretsManagerClient: MockSecretsManagerClient,
    GetSecretValueCommand: MockGetSecretValueCommand,
  };
});

// Mock delivery methods with delegating wrappers so we can control mocks in tests
const sendEmailMock = vi.fn().mockResolvedValue({ success: true });
const sendSmsMock = vi.fn().mockResolvedValue({ success: true });
const sendPushMock = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../services/notification.delivery', () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  sendSms: (...args: any[]) => sendSmsMock(...args),
  sendPush: (...args: any[]) => sendPushMock(...args),
}));

let sendEmail: any, sendSms: any, sendPush: any, handler: any;

beforeEach(async () => {
  vi.clearAllMocks();

  sendEmailMock.mockClear();
  sendEmailMock.mockResolvedValue({ success: true });
  sendSmsMock.mockClear();
  sendSmsMock.mockResolvedValue({ success: true });
  sendPushMock.mockClear();
  sendPushMock.mockResolvedValue({ success: true });

  sendEmail = sendEmailMock;
  sendSms = sendSmsMock;
  sendPush = sendPushMock;

  const consumer = await vi.importActual('../notification.consumer');
  handler = consumer.handler;
});

describe('notification.consumer', () => {
  it('should call sendEmail and sendSms for channels', async () => {
    const envelope = {
      eventType: 'UserCreatedNotificationRequested',
      payload: {
        userId: 'u1',
        email: 'a@b.com',
        phone: '9123456789',
        deviceToken: 'dev-123',
        name: 'Test',
        channels: ['email', 'sms', 'push'],
        template: 'WELCOME',
        templateData: { foo: 'bar' },
      },
    };

    const event = { Records: [{ Sns: { Message: JSON.stringify(envelope) } }] } as any;
    const res = await handler(event, {} as any);
    expect(sendEmail).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalled();
    expect(res).toBeDefined();
  });
});
