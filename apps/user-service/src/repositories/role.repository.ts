import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { Feature, OrgFeature } from '../types/feature-types';

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

  async getUserPermission(
    organizationId: string,
    userId: string,
    orgFetaures: any,
    authHeader?: string,
  ): Promise<any> {
    const baseUrl = process.env.ROLE_API_URL;
    const logger = createChildLogger(baseLogger, { organizationId, userId });

    if (!baseUrl) {
      logger.warn({ event: 'user_permission_api_missing' });
      return null;
    }

    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/users/${userId}/permissions`;
console.log("USER DATA 1421 URL : ", url);
    try {
      logger.info({ event: 'get_user_permission_api_start', url });
      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(authHeader),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn({ event: 'get_user_permission_api_non_ok', status: response.status, body: errorText });
        return null;
      }

      const body = (await response.json()) as any;
      logger.info({ event: 'get_user_permission_api_success' });
      return this.filterFeaturesByOrgPermissions(body?.data.items ?? body, orgFetaures);
    } catch (err) {
      logger.error({ event: 'get_user_permission_api_failed', err: serializeError(err) });
      return null;
    }
  }


  async filterFeaturesByOrgPermissions(
    features: Feature[],
    orgFeatures: OrgFeature[],
  ): Promise<Feature[]> {
    console.log("USER DATA FEATURES : ", features.length);
    console.log("USER DATA ORG FEATURES : ", orgFeatures.length);
    const orgFeatureMap = new Map<string, OrgFeature>();
    for (const orgFeature of orgFeatures) {
      orgFeatureMap.set(orgFeature.featureKey, orgFeature);
    }
  
    const featureKeySet = new Set(features.map((f) => f.featureKey));
    const result: Feature[] = [];
  
    // Keep features present in orgFeatures, but remove functionalities with access=false
    for (const feature of features) {
      const orgFeature = orgFeatureMap.get(feature.featureKey);
      if (!orgFeature) continue; // skip if org doesn’t have this feature
  
      const orgFunctionalitiesMap = new Map(
        (orgFeature.functionalities || []).map((f) => [f.key, f]),
      );
  
  
      const updatedFunctionalities = (feature.functionalities || [])
        .filter((func) => {
          const orgFunc = orgFunctionalitiesMap.get(func.key);
          // keep only if orgFunc doesn’t exist OR has access=true
          return !orgFunc || orgFunc.access !== false;
        })
        .map((func) => ({
          ...func,
          access: func.access, // preserve original access from default feature
        }));
  
      // Push the feature even if some functionalities were removed
      result.push({
        ...feature,
        functionalities: updatedFunctionalities,
      });
    }
  
    // Add extra orgFeatures not in default list (only with allowed functionalities)
    for (const orgFeature of orgFeatures) {
      if (!featureKeySet.has(orgFeature.featureKey)) {
        const filteredFunctionalities = (orgFeature.functionalities || []).filter(
          (func) => func.access !== false,
        );
  
        if (filteredFunctionalities.length === 0) continue; // skip if all are disabled
  
        const fakeFunctionalities = filteredFunctionalities.map((func) => ({
          ...func,
          access: false,
        }));
  
        result.push({
          ...orgFeature,
          functionalities: fakeFunctionalities,
          itemType: "Feature",
        });
      }
    }
  
    return result;
  }
}
