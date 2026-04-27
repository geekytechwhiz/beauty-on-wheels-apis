/**
 * Upstream HTTP client for `AlertService` only — not for controllers.
 * @see `apps/alert-service/docs/http-api-implementation-guide.md` §3
 */
import axios from 'axios';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Validates the patient (user) exists in the organization via user-service GET
 * `user/organization/{organizationId}/{userId}` under {@link process.env.USER_SERVICE_BASE_URL}.
 *
 * Optional override: `USER_SERVICE_PATIENT_LOOKUP_URL` with `{organizationId}` and `{userId}`.
 * If neither base URL nor template is set, validation is skipped.
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
  if (!url) return;
  const res = await axios.get(url, {
    headers: authHeader ? { Authorization: authHeader } : {},
    timeout: Number(process.env.USER_SERVICE_TIMEOUT_MS ?? '8000'),
    validateStatus: () => true,
  });
  if (res.status === 404) {
    const e = new Error('Patient not found') as Error & { statusCode: number; code: string };
    e.statusCode = 404;
    e.code = 'PATIENT_NOT_FOUND';
    throw e;
  }
  if (res.status >= 400) {
    const e = new Error('User service validation failed') as Error & { statusCode: number; code: string };
    e.statusCode = 502;
    e.code = 'USER_SERVICE_UPSTREAM';
    throw e;
  }
}
