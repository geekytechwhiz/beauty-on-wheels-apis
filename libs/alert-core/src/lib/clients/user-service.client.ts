/**
 * Upstream HTTP client for {@link AlertService} only — not for controllers.
 */
import { BaseError } from '@api-hub/utils';

import { executeUpstreamGet } from './upstream-http';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Validates the patient (user) exists in the organization via user-service GET
 * `user/organization/{organizationId}/{userId}` using the `USER_SERVICE_BASE_URL` env var.
 */
export async function validatePatientContext(
  userId: string,
  organizationId: string,
  authHeader?: string,
): Promise<void> {
  const template = process.env.USER_SERVICE_PATIENT_LOOKUP_URL?.trim();
  const base = trimTrailingSlash(process.env.USER_SERVICE_BASE_URL || '');
  let url: string | undefined;
  if (template) {
    url = template
      .replace('{organizationId}', encodeURIComponent(organizationId))
      .replace('{userId}', encodeURIComponent(userId));
  } else if (base) {
    url = `${base}/user/organization/${encodeURIComponent(organizationId)}/${encodeURIComponent(userId)}`;
  }
  if (!url) {
    return;
  }
  const res = await executeUpstreamGet({
    dependency: 'user-service',
    url,
    headers: authHeader ? { Authorization: authHeader } : {},
    timeoutMs: Number(process.env.USER_SERVICE_TIMEOUT_MS ?? '8000'),
    maxRetriesEnvKey: 'USER_SERVICE_MAX_RETRIES',
  });
  if (res.status === 404) {
    throw new BaseError('Patient not found', 404, 'PATIENT_NOT_FOUND', [
      { message: 'Patient not found' },
    ]);
  }
  if (res.status >= 400) {
    throw new BaseError('User service validation failed', 502, 'USER_SERVICE_UPSTREAM', [
      { message: 'User service validation failed' },
    ], {
      retryable: true,
      metadata: { dependency: 'user-service' },
    });
  }
}
