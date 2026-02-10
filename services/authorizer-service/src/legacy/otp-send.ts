/**
 * Legacy OTP SMS send via enduser-messaging service.
 * Fire-and-forget: does not block authorizer response; errors are logged only.
 */

const DEFAULT_OTP_MESSAGE = 'Your OTP code';

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
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  }).catch((err) => {
    console.warn('OTP send failed (non-blocking)', { message: (err as Error).message });
  });
}
