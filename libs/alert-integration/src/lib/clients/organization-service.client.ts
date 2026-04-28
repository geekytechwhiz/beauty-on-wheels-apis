/**
 * Upstream HTTP client for `AlertService` only — not for controllers.
 * @see `apps/alert-service/docs/http-api-implementation-guide.md` §3
 */
import axios from 'axios';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Validates organization exists via organization-service GET `organization/{organizationId}`
 * under {@link process.env.ORGANIZATION_SERVICE_BASE_URL}.
 *
 * Optional override: `ORGANIZATION_SERVICE_LOOKUP_URL` with `{organizationId}`.
 * If neither base URL nor template is set, validation is skipped.
 */
export async function validateOrganizationContext(organizationId: string, authHeader?: string): Promise<void> {
  const template = process.env.ORGANIZATION_SERVICE_LOOKUP_URL?.trim();
  const base = trimTrailingSlash(process.env.ORGANIZATION_SERVICE_BASE_URL || '');
  let url: string | undefined;
  if (template) {
    url = template.replace('{organizationId}', encodeURIComponent(organizationId));
  } else if (base) {
    url = `${base}/organization/${encodeURIComponent(organizationId)}`;
  }
  if (!url) {
    return;
  }
  const res = await axios.get(url, {
    headers: authHeader ? { Authorization: authHeader } : {},
    timeout: Number(process.env.ORGANIZATION_SERVICE_TIMEOUT_MS ?? '8000'),
    validateStatus: () => true,
  });
  if (res.status === 404) {
    const e = new Error('Organization not found') as Error & { statusCode: number; code: string };
    e.statusCode = 404;
    e.code = 'ORG_NOT_FOUND';
    throw e;
  }
  if (res.status >= 400) {
    const e = new Error('Organization service validation failed') as Error & { statusCode: number; code: string };
    e.statusCode = 502;
    e.code = 'ORG_SERVICE_UPSTREAM';
    throw e;
  }
}
