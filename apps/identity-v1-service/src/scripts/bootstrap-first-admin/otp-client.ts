import { BootstrapError } from './types';
import { sanitizeForLog } from './sanitize';

export type OtpSendResult = {
  success: boolean;
  referenceId: string;
};

/**
 * Calls public Identity OTP endpoints. Tokens from verify are discarded and
 * never returned to callers so they cannot be logged or journaled.
 */
export async function sendOtpChallenge(input: {
  apiBaseUrl: string;
  destination: string;
  userType: 'CUSTOMER' | 'VENDOR';
  fetchImpl: typeof fetch;
}): Promise<OtpSendResult> {
  let response: Response;
  try {
    response = await input.fetchImpl(`${input.apiBaseUrl}/otp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        destination: input.destination,
        userType: input.userType,
      }),
    });
  } catch (error) {
    throw new BootstrapError(
      'OTP send request failed (network)',
      'OTP_SEND_NETWORK_FAILED',
      { recoverable: true, cause: error },
    );
  }

  const body = (await safeJson(response)) as {
    success?: boolean;
    referenceId?: string;
    message?: string;
    code?: string;
  };

  if (!response.ok || !body.referenceId) {
    throw new BootstrapError(
      `OTP send failed with HTTP ${response.status}`,
      'OTP_SEND_FAILED',
      {
        recoverable: true,
        recoveryHint: `Sanitized API error: ${JSON.stringify(sanitizeForLog(body))}`,
      },
    );
  }

  return {
    success: body.success !== false,
    referenceId: body.referenceId,
  };
}

/**
 * Verifies OTP. Intentionally returns only success — access/refresh tokens from
 * the Identity response are dropped immediately and never exposed.
 */
export async function verifyOtpChallenge(input: {
  apiBaseUrl: string;
  destination: string;
  otp: string;
  fetchImpl: typeof fetch;
}): Promise<{ verified: true }> {
  let response: Response;
  try {
    response = await input.fetchImpl(`${input.apiBaseUrl}/otp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        destination: input.destination,
        otp: input.otp,
      }),
    });
  } catch (error) {
    throw new BootstrapError(
      'OTP verify request failed (network)',
      'OTP_VERIFY_NETWORK_FAILED',
      { recoverable: true, cause: error },
    );
  } finally {
    // Clear caller-held OTP as soon as the request is in flight/done.
    (input as { otp?: string }).otp = undefined;
  }

  const body = (await safeJson(response)) as Record<string, unknown>;

  // Drop any token fields before further handling.
  if (body && typeof body === 'object') {
    delete body.accessToken;
    delete body.refreshToken;
    delete body.idToken;
    delete body.token;
  }

  if (!response.ok) {
    throw new BootstrapError(
      `OTP verify failed with HTTP ${response.status}`,
      'OTP_VERIFY_FAILED',
      {
        recoverable: true,
        recoveryHint: `Sanitized API error: ${JSON.stringify(
          sanitizeForLog({
            code: body.code,
            message: body.message,
            status: response.status,
          }),
        )}`,
      },
    );
  }

  return { verified: true };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
