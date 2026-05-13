
import { createChildLogger, createLogger, logger, serializeError } from '@api-hub/observability';
const baselogger = createLogger({ service: 'user-service', redactPII: true });

const PACKAGE_TABLE_NAME = process.env.PACKAGE_TABLE || '';
const buildHeaders = (authHeader?: string) => ({
  'Content-Type': 'application/json',
  ...(authHeader ? { Authorization: authHeader } : {}),
});
export class PackageRepository {
 
    async getOrgFeatures(organizationId: string, authHeader?: string): Promise<any> {
      const baseUrl = process.env.PACKAGE_API_URL;
      // console.log("PACKAGE API URL :", baseUrl);
      // console.log("orgId :", organizationId);

      const logger = createChildLogger(baselogger, { organizationId });
      if (!baseUrl) {
        logger.warn({ event: 'organization_roles_api_missing' });
        return false;
      }
      const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/features`;
      // console.log("URL :", url);
      try {
        logger.info({ event: 'organization_roles_api_start', url });
        const response = await fetch(url, {
          method: 'GET',
          headers: buildHeaders(authHeader)
        });
        const res = await response.json() as any;

        if (!res.success) {
          logger.warn({ event: 'organization_features_api_non_ok', status: response.status });
          return false;
        }
        logger.info({ event: 'organization_features_api_success' });
        return res.data.items || [];
      } catch (err) {
        logger.error({ event: 'organization_features_api_failed', err: serializeError(err) });
        return false;
      }
    }

}
