/**
 * Upstream HTTP client for {@link AlertService} only — not for controllers.
 */
import { BaseError } from '@api-hub/utils';

import { executeUpstreamGet } from './upstream-http';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Validates organization exists via organization-service GET `organization/{organizationId}`.
 */
export async function validateOrganizationContext(
  organizationId: string,
  authHeader?: string,
): Promise<void> {
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
  const res = await executeUpstreamGet({
    dependency: 'organization-service',
    url,
    headers: authHeader ? { Authorization: authHeader } : {},
    timeoutMs: Number(process.env.ORGANIZATION_SERVICE_TIMEOUT_MS ?? '8000'),
    maxRetriesEnvKey: 'ORGANIZATION_SERVICE_MAX_RETRIES',
  });
  if (res.status === 404) {
    throw new BaseError('Organization not found', 404, 'ORG_NOT_FOUND', [
      { message: 'Organization not found' },
    ]);
  }
  if (res.status >= 400) {
    throw new BaseError(
      'Organization service validation failed',
      502,
      'ORG_SERVICE_UPSTREAM',
      [{ message: 'Organization service validation failed' }],
      {
        retryable: true,
        metadata: { dependency: 'organization-service' },
      },
    );
  }
}
