import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const buildHeaders = (authHeader?: string) => ({
  'Content-Type': 'application/json',
  ...(authHeader ? { Authorization: authHeader } : {}),
});

export class RoleRepository {

   async saveRoles(organizationId: string,roleId:string,roleName:string,roleDescription:string,roleType:string, features:any, authHeader?: string): Promise<boolean> {
    const baseUrl = process.env.ROLE_API_URL;
    const logger = createChildLogger(baseLogger, { organizationId });

  console.log("paylaod", JSON.stringify({ isOnboarding: false,orgId: organizationId, roleId: roleId, roleName: roleName, roleDescription: roleDescription, roleType: roleType}));
    if (!baseUrl) {
      logger.warn({ event: 'organization_roles_api_missing' });
      return false;
    }
    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/roles`;
    try {
      logger.info({ event: 'organization_roles_api_start', url });
       const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(authHeader),
        body: JSON.stringify({ isOnboarding: false,orgId: organizationId, roleId: roleId, roleName: roleName, roleDescription: roleDescription, roleType: roleType,  features: features }),
      });

      const res = await response.json() as any;
      if (!res.success) {
        logger.warn({ event: 'organization_features_api_non_ok', status: response.status });
        return false;
      }
      return true;
    } catch (err) {
      logger.error({ event: 'organization_roles_api_failed', err: serializeError(err) });
      return false;
    }
  }
}
