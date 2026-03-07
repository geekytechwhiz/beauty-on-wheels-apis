import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { Feature, OrgFeature } from '../types/feature-types';

import { QueryCommand, QueryCommandOutput } from "@aws-sdk/lib-dynamodb"; 
import { docClient } from '../utils/db.config';
import { sendDoc } from '../utils/dynamodb-send';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const buildHeaders = (authHeader?: string) => ({
  'Content-Type': 'application/json',
  ...(authHeader ? { Authorization: authHeader } : {}),
});

export class RoleRepository {

  async saveRoles(
    organizationId: string,
    roleId: string,
    roleName: string,
    roleDescription: string,
    roleType: string,
    features: any,
    authHeader?: string
  ): Promise<boolean> {

    const baseUrl = process.env.ROLE_API_URL;
    const logger = createChildLogger(baseLogger, { organizationId });

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
        body: JSON.stringify({
          isOnboarding: false,
          orgId: organizationId,
          roleId,
          roleName,
          roleDescription,
          roleType,
          features
        }),
      });

      const res = await response.json() as any;

      if (!res.success) {
        logger.warn({ event: 'organization_features_api_non_ok', status: response.status });
        return false;
      }

      return true;

    } catch (err) {

      logger.error({
        event: 'organization_roles_api_failed',
        err: serializeError(err)
      });

      return false;
    }
  }

  async getRolePermissions(
    roleId: string,
    organizationId: string,
  ): Promise<any[]> {

    const logger = createChildLogger(baseLogger, { roleId, organizationId });
    const ROLES_TABLE = process.env.ROLES_TABLE;

    if (!ROLES_TABLE) {
      logger.warn({
        event: 'getRolePermissions_missing_roles_table',
        message: 'ROLES_TABLE env var is not set',
      });
      return [];
    }

    try {

      const params = {
        TableName: ROLES_TABLE,
        KeyConditionExpression: '#PK = :PK AND begins_with(#SK, :SK)',
        ExpressionAttributeNames: {
          '#PK': 'PK',
          '#SK': 'SK',
        },
        ExpressionAttributeValues: {
          ':PK': `ORG#${organizationId}`,
          ':SK': `ROLE#${roleId}`,
        },
      };

      const result = await sendDoc<QueryCommandOutput>(
        docClient,
        new QueryCommand(params)
      );

      if (result.Items && result.Items.length > 0) {

        logger.info({
          event: 'getRolePermissions_success',
          roleId
        });

        return result.Items;
      }

      return [];

    } catch (err) {

      const name = (err as { name?: string })?.name;
      const message = (err as { message?: string })?.message || '';

      if (
        name === 'ValidationException' &&
        (message.includes('PK') ||
          message.includes('SK') ||
          message.includes('key schema'))
      ) {

        try {

          const fallbackParams = {
            TableName: ROLES_TABLE,
            KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
            ExpressionAttributeNames: {
              '#pk': 'pk',
              '#sk': 'sk',
            },
            ExpressionAttributeValues: {
              ':pk': `ORG#${organizationId}`,
              ':sk': `ROLE#${roleId}`,
            },
          };

          const fallbackResult = await sendDoc<QueryCommandOutput>(
            docClient,
            new QueryCommand(fallbackParams)
          );

          if (fallbackResult.Items && fallbackResult.Items.length > 0) {

            logger.info({
              event: 'getRolePermissions_success_fallback_pk_sk',
              roleId
            });

            return fallbackResult.Items;
          }

          return [];

        } catch (fallbackErr) {

          logger.error({
            event: 'getRolePermissions_error_fallback_pk_sk',
            err: serializeError(fallbackErr),
          });

          return [];
        }
      }

      logger.error({
        event: 'getRolePermissions_error',
        err: serializeError(err),
      });

      return [];
    }
  }

  async getUserPermissionsList(
    organizationId: string,
    userId: string,
    authHeader?: string,
  ): Promise<unknown[] | null> {

    const baseUrl = process.env.ROLE_API_URL;
    const logger = createChildLogger(baseLogger, { organizationId, userId });

    if (!baseUrl) {
      logger.warn({ event: 'user_permissions_list_api_missing' });
      return null;
    }

    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/users/${userId}/permissions`;

    try {

      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(authHeader)
      });

      if (!response.ok) {

        logger.warn({
          event: 'get_user_permissions_list_non_ok',
          status: response.status
        });

        return null;
      }

      const body = await response.json() as {
        data?: { items?: unknown[] };
        items?: unknown[];
      };

      const items = body?.data?.items ?? body?.items;

      return Array.isArray(items) ? items : null;

    } catch (err) {

      logger.error({
        event: 'get_user_permissions_list_failed',
        err: serializeError(err)
      });

      return null;
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

    try {

      logger.info({ event: 'get_user_permission_api_start', url });

      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(authHeader),
      });

      if (!response.ok) {

        const errorText = await response.text();

        logger.warn({
          event: 'get_user_permission_api_non_ok',
          status: response.status,
          body: errorText
        });

        return null;
      }

      const body = await response.json() as {
        data?: { items?: unknown[] };
        items?: unknown[];
      };

      logger.info({ event: 'get_user_permission_api_success' });

      const result = body?.data?.items ?? body;
      const roleFeatures:any = Array.isArray(result) ? result : [];

      let features: Feature[] = [];

      if (roleFeatures.length > 0) {

        const firstItemFeatures = roleFeatures[0]?.features as Feature[];

        if (Array.isArray(firstItemFeatures)) {
          features = firstItemFeatures;
        } else if (firstItemFeatures && typeof firstItemFeatures === 'object') {
          features = Object.values(firstItemFeatures);
        }
      }

      const updatedFeatures = await this.filterFeaturesByOrgPermissions(
        features,
        orgFetaures
      );

      (roleFeatures[0] as any).features = updatedFeatures as Feature[];

      return roleFeatures;

    } catch (err) {

      logger.error({
        event: 'get_user_permission_api_failed',
        err: serializeError(err)
      });

      return null;
    }
  }

  async filterFeaturesByOrgPermissions(
    features: Feature[],
    orgFeatures: OrgFeature[],
  ): Promise<Feature[]> {

    const featureKeySet = new Set(features.map((f) => f.featureKey));
    const result: Feature[] = [];

    const orgFeatureMap = new Map<string, OrgFeature>();

    for (const orgFeature of orgFeatures) {
      orgFeatureMap.set(orgFeature.featureKey, orgFeature);
    }

    for (const feature of features) {

      const orgFeature = orgFeatureMap.get(feature.featureKey);

      if (!orgFeature) continue;

      const orgFunctionalitiesMap = new Map(
        (orgFeature.functionalities || []).map((f) => [f.key, f]),
      );

      const updatedFunctionalities = (feature.functionalities || [])
        .filter((func) => {
          const orgFunc = orgFunctionalitiesMap.get(func.key);
          return !orgFunc || orgFunc.access !== false;
        })
        .map((func) => ({
          ...func,
          access: func.access,
        }));

      result.push({
        ...feature,
        functionalities: updatedFunctionalities,
      });
    }

    for (const orgFeature of orgFeatures) {

      if (!featureKeySet.has(orgFeature.featureKey)) {

        const functionalitiesWithAccessFalse =
          (orgFeature.functionalities || []).map((func) => ({
            ...func,
            access: false,
          }));

        result.push({
          ...orgFeature,
          functionalities: functionalitiesWithAccessFalse,
          itemType: "Feature",
        });
      }
    }

    return result;
  }
}