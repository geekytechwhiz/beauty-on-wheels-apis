import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

// Mock logger to avoid module resolution issues
vi.mock('@api-hub/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
  serializeError: vi.fn((err) => ({ message: err.message, stack: err.stack })),
}));

// Mock SecretsManagerClient
// Ensure secret name is set for getSecrets
process.env.NOTIFICATION_SECRET_NAME = process.env.NOTIFICATION_SECRET_NAME || 'test-secret';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notification.delivery', () => {
  it('sendEmail should call external email API', async () => {
    (axios as any).mockResolvedValue({ data: {} });
    await sendEmail({ email: 'test@example.com', template: 'WELCOME', templateData: { name: 'John' } });
    expect((axios as any).mock.calls.length).toBeGreaterThan(0);
    const call = (axios as any).mock.calls[0][0];
    expect(call.url).toBe('https://email.test');
    expect(call.data).toBeDefined();
    expect(call.data.emailId).toBe('test@example.com');
  });

  it('sendSms should call external sms API with normalized phone', async () => {
    (axios as any).mockResolvedValue({ data: {} });
    await sendSms({ phone: '9123456789', template: 'WELCOME', templateData: { org: 'Org' } });
    expect((axios as any).mock.calls.length).toBeGreaterThan(0);
    const call = (axios as any).mock.calls[0][0];
    expect(call.url).toBe('https://sms.test');
    expect(call.data.phoneNumber).toBe('+919123456789');
  });

  it('sendPush currently returns not implemented', async () => {
    const res = await sendPush({ deviceToken: 'dev-123', template: 'WELCOME' });
    expect(res).toEqual({ success: false, reason: 'not_implemented' });
  });
});
