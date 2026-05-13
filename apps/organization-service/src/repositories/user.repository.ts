import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const buildHeaders = (authHeader?: string) => ({
  'Content-Type': 'application/json',
  ...(authHeader ? { Authorization: authHeader } : {}),
});

const buildUserServiceUrl = (baseUrl: string, organizationId: string, userId: string) =>
  `${baseUrl.replace(/\/$/, '')}/organization/${organizationId}/${userId}`;

export class UserRepository {
  async getUser(
    organizationId: string,
    userId: string,
    authHeader?: string,
  ): Promise<Record<string, unknown> | null> {
    const baseUrl = process.env.USER_SERVICE_URL;
    const logger = createChildLogger(baseLogger, { organizationId, userId });
    if (!baseUrl) {
      logger.warn({ event: 'user_service_api_missing' });
      return null;
    }
    const url = buildUserServiceUrl(baseUrl, organizationId, userId);
    try {
      // console.log('url', url);
      // console.log('headers', buildHeaders(authHeader));

      // console.log('authHeader', authHeader);
      const response = await fetch(url, { headers: buildHeaders(authHeader) });
      // console.log('response', response);
      if (!response.ok) {
        logger.warn({ event: 'user_service_api_non_ok', status: response.status });
        return null;
      }
      const body = (await response.json()) as any;
      return (body?.data || body) as Record<string, unknown>;
    } catch (err) {
      logger.error({ event: 'user_service_api_failed', err: serializeError(err) });
      return null;
    }
  }
}
