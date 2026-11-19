import { BootstrapError } from './types';
import { sanitizeForLog } from './sanitize';

export type OtpSendResult = {
  success: boolean;
  referenceId: string;
};

type ApiEnvelope = {
  success?: boolean;
  referenceId?: string;
  message?: unknown;
  code?: string;
  data?: {
    success?: boolean;
    referenceId?: string;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    token?: string;
  };
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  token?: string;
};

/**
 * Identity HTTP handlers wrap payloads as `{ success, data, ... }`. Accept both
 * the enveloped shape and a flat `{ referenceId }` body used by unit tests.
 */
function unwrapData<T extends Record<string, unknown>>(body: T): T & Record<string, unknown> {
  const data = (body as ApiEnvelope).data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...body, ...data };
  }
  return body;
}

function scrubTokens(body: Record<string, unknown>): void {
  delete body.accessToken;
  delete body.refreshToken;
  delete body.idToken;
  delete body.token;
  const nested = body.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const data = nested as Record<string, unknown>;
    delete data.accessToken;
    delete data.refreshToken;
    delete data.idToken;
    delete data.token;
  }
}

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

  const raw = (await safeJson(response)) as ApiEnvelope;
  const body = unwrapData(raw as Record<string, unknown>) as ApiEnvelope;
  const referenceId =
    typeof body.referenceId === 'string' ? body.referenceId.trim() : '';

  if (!response.ok || !referenceId || body.success === false) {
    throw new BootstrapError(
      `OTP send failed with HTTP ${response.status}`,
      'OTP_SEND_FAILED',
      {
        recoverable: true,
        recoveryHint: `Sanitized API error: ${JSON.stringify(sanitizeForLog(raw))}`,
      },
    );
  }

  return {
    success: body.success !== false,
    referenceId,
  };
}

/**
 * Verifies OTP. Intentionally returns only success — access/refresh tokens from
 * the Identity response are dropped immediately and never exposed.
 *
 * A successful verify is what creates (or reuses) the Cognito principal and the
 * Identity DynamoDB user. This client only checks HTTP success; the saga then
 * asserts both stores via destination lookup / Cognito probe.
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
  scrubTokens(body);

  const unwrapped = unwrapData(body) as ApiEnvelope;
  scrubTokens(unwrapped as Record<string, unknown>);

  if (!response.ok || unwrapped.success === false) {
    throw new BootstrapError(
      `OTP verify failed with HTTP ${response.status}`,
      'OTP_VERIFY_FAILED',
      {
        recoverable: true,
        recoveryHint: `Sanitized API error: ${JSON.stringify(
          sanitizeForLog({
            code: unwrapped.code,
            message: unwrapped.message,
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
