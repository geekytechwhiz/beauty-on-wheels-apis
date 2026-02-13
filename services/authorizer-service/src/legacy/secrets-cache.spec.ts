/**
 * Unit tests for legacy secrets cache (Secrets Manager).
 */

import { getLegacySecrets } from './secrets-cache';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  GetSecretValueCommand: jest.fn().mockImplementation((input: unknown) => ({ __input: input })),
}));

describe('secrets-cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns parsed SecretString and caches by secret name', async () => {
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ USER_POOL_ID: 'us-east-1_abc123' }),
    });

    const result = await getLegacySecrets('my-secret');
    expect(result).toEqual({ USER_POOL_ID: 'us-east-1_abc123' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('uses SecretBinary when SecretString is absent', async () => {
    const json = JSON.stringify({ USER_POOL_ID: 'us-east-1_binary' });
    mockSend.mockResolvedValue({
      SecretBinary: Buffer.from(json, 'ascii').toString('base64'),
    });

    const result = await getLegacySecrets('binary-secret');
    expect(result).toEqual({ USER_POOL_ID: 'us-east-1_binary' });
  });

  it('uses empty object when SecretBinary is null', async () => {
    mockSend.mockResolvedValue({
      SecretBinary: null,
    });

    const result = await getLegacySecrets('empty-secret');
    expect(result).toEqual({});
  });

  it('returns cached result when same secret name is requested again', async () => {
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ USER_POOL_ID: 'cached-pool' }),
    });

    const first = await getLegacySecrets('cache-test');
    const second = await getLegacySecrets('cache-test');
    expect(first).toEqual(second);
    expect(first.USER_POOL_ID).toBe('cached-pool');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('calls Secrets Manager again when secret name changes', async () => {
    mockSend
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({ USER_POOL_ID: 'pool-a' }),
      })
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({ USER_POOL_ID: 'pool-b' }),
      });

    const a = await getLegacySecrets('secret-a');
    const b = await getLegacySecrets('secret-b');
    expect(a.USER_POOL_ID).toBe('pool-a');
    expect(b.USER_POOL_ID).toBe('pool-b');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
