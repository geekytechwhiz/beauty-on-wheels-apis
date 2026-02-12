/**
 * Legacy OTP SMS send via enduser-messaging service.
 * Fire-and-forget: does not block authorizer response; errors are logged only.
 * Uses a short timeout so the request does not keep the process alive.
 */

const DEFAULT_OTP_MESSAGE = 'Your OTP code';

/** Timeout for OTP HTTP request (ms). Prevents hanging requests. */
const OTP_FETCH_TIMEOUT_MS = 2000;

/**
 * Sends OTP SMS to the given phone number. Non-blocking; errors are caught and logged.
 * Call after successful auth so existing consumer functionality (OTP sending) is preserved.
 */
export function sendOtpFireAndForget(
  baseUrl: string,
  phoneNumber: string,
  message: string = DEFAULT_OTP_MESSAGE
): void {
  if (!baseUrl?.trim() || !phoneNumber?.trim()) {
    return;
  }
  const url = `${baseUrl.replace(/\/$/, '')}/send-sms`;
  const body = JSON.stringify({ phoneNumber: phoneNumber.trim(), message });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OTP_FETCH_TIMEOUT_MS);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
    signal: controller.signal,
  })
    .finally(() => clearTimeout(timer))
    .catch(() => {
      console.warn('OTP send failed (non-blocking)');
    });
}
