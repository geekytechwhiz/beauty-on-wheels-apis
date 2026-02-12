/**
 * Unit tests for legacy OTP send (fire-and-forget).
 */

import { sendOtpFireAndForget } from './otp-send';

const originalFetch = globalThis.fetch;

describe('otp-send', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns early when baseUrl is empty', () => {
    sendOtpFireAndForget('', '5551234567');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns early when baseUrl is only whitespace', () => {
    sendOtpFireAndForget('   ', '5551234567');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns early when phoneNumber is empty', () => {
    sendOtpFireAndForget('https://msg.example', '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns early when phoneNumber is only whitespace', () => {
    sendOtpFireAndForget('https://msg.example', '   ');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls fetch with correct url and body (strips trailing slash from baseUrl)', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    sendOtpFireAndForget('https://msg.example/', ' 5551234567 ');
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://msg.example/send-sms',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: '5551234567',
          message: 'Your OTP code',
        }),
      })
    );
  });

  it('uses custom message when provided', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    sendOtpFireAndForget('https://msg.example', '5551234567', 'Custom OTP');
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://msg.example/send-sms',
      expect.objectContaining({
        body: JSON.stringify({
          phoneNumber: '5551234567',
          message: 'Custom OTP',
        }),
      })
    );
  });

  it('catches fetch rejection and does not throw', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    fetchMock.mockRejectedValue(new Error('network error'));

    sendOtpFireAndForget('https://msg.example', '5551234567');
    await new Promise((r) => setTimeout(r, 10));

    expect(warnSpy).toHaveBeenCalledWith('OTP send failed (non-blocking)');
    warnSpy.mockRestore();
  });
});
