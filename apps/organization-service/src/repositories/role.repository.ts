import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const buildHeaders = (authHeader?: string) => ({
  'Content-Type': 'application/json',
  ...(authHeader ? { Authorization: authHeader } : {}),
});

export class RoleRepository {
  async createDefaultRoles(
    organizationId: string,
    authHeader?: string,
    payload?: Record<string, unknown>,
  ): Promise<boolean> {
    const baseUrl = process.env.ROLE_API_URL;
    const logger = createChildLogger(baseLogger, { organizationId });
    if (!baseUrl) {
      logger.warn({ event: 'organization_roles_api_missing' });
      return false;
    }
    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/defaultRoles`;
    try {
      logger.info({ event: 'organization_roles_api_start', url });
      const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(authHeader),
        body: JSON.stringify(payload ?? { isOnboarding: true }),
      });
      if (!response.ok) {
        logger.warn({ event: 'organization_roles_api_non_ok', status: response.status });
        return false;
      }
      logger.info({ event: 'organization_roles_api_success' });
      return true;
    } catch (err) {
      logger.error({ event: 'organization_roles_api_failed', err: serializeError(err) });
      return false;
    }
  }
}
