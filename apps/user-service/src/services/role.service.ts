import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const buildHeaders = (authHeader?: string) => ({
  'Content-Type': 'application/json',
  ...(authHeader ? { Authorization: authHeader } : {}),
});

export const getRoleDetails = async (
  roleId: string,
  organizationId: string,
  authHeader?: string,
) => {
  const baseUrl = process.env.ROLE_API_URL;
  const logger = createChildLogger(baseLogger, { roleId, organizationId });
  if (!baseUrl) {
    logger.warn({ event: 'org_role_api_missing' });
    return [];
  }
  try {
    console.log("URL DATA :", `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/roles/${roleId}/permissions`);
    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/roles/${roleId}/permissions`;
    console.log("URL DATA :", url);
    logger.info({ event: 'get_role_api_start', url });
    const response = await fetch(url, { headers: buildHeaders(authHeader) });
    if (!response.ok) {
      logger.warn({ event: 'get_role_api_non_ok', status: response.status });
      return [];
    }
    const body = (await response.json()) as any;
    logger.info({ event: 'get_role_api_success' });
    return body?.data || body || [];
  } catch (error) {
    logger.error({ event: 'get_role_api_failed', err: serializeError(error) });
    return [];
  }
};

export const getUserPermissions = async (
  userId: string,
  organizationId: string,
  authHeader?: string,
) => {
  const baseUrl = process.env.ROLE_API_URL;
  console.log('BASE URL :', baseUrl);
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  if (!baseUrl) {
    logger.warn({ event: 'user_permissions_api_missing' });
    return {
      roleId: null,
      roleName: '',
      roleType: '',
      definedRoleCode: '',
      isDefault: false,
      features: [],
    };
  }
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/users/${userId}/permissions`;
    console.log('URL :', url);
    logger.info({ event: 'get_user_permissions_api_start', url });

    const response = await fetch(url, { headers: buildHeaders(authHeader) });
    console.log('RESPONSE STATUS :', response.status);
    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ event: 'get_user_permissions_api_non_ok', status: response.status, body: errorText });
      return {
        roleId: null,
        roleName: '',
        roleType: '',
        definedRoleCode: '',
        isDefault: false,
        features: [],
      };
    }

    const body = (await response.json()) as any;
    console.log('BODY :', JSON.stringify(body).slice(0, 500));
    logger.info({ event: 'get_user_permissions_api_success' });

    // From your sample the shape is: { data: { items: [ { roleId, roleName, roleType, definedRoleCode, isDefault, features: [...] } ] } }
    const items = Array.isArray(body?.data?.items) ? body.data.items : [];
    if (!items.length) {
      logger.warn({ event: 'get_user_permissions_no_items', message: 'data.items is empty' });
      return {
        roleId: null,
        roleName: '',
        roleType: '',
        definedRoleCode: '',
        isDefault: false,
        features: [],
      };
    }

    const firstRole = items[0];
    const features = firstRole?.features;
    let featureArray: any[] = [];
    if (Array.isArray(features)) {
      featureArray = features;
    } else if (features && typeof features === 'object') {
      featureArray = Object.values(features);
    }

    console.log('EXTRACTED FEATURES COUNT :', featureArray.length);

    return {
      roleId: firstRole.roleId || firstRole.roleID || null,
      roleName: firstRole.roleName || firstRole.definedRoleCode || '',
      roleType: firstRole.roleType || '',
      definedRoleCode: firstRole.definedRoleCode || '',
      isDefault: firstRole.isDefault ?? false,
      features: Array.isArray(featureArray) ? featureArray : [],
    };
  } catch (error) {
    console.log('ERROR from permissions api:', error);
    logger.error({ event: 'get_user_permissions_api_failed', err: serializeError(error) });
    return {
      roleId: null,
      roleName: '',
      roleType: '',
      definedRoleCode: '',
      isDefault: false,
      features: [],
    };
  }
};

export const assignUserRole = async (
  roleId: string,
  organizationId: string,
  userId: string,
  fullName: string,
  emailAddress?: string,
  phoneNumber?: string,
  profilePic?: string,
  authHeader?: string,
) => {
  const baseUrl = process.env.ROLE_API_URL;
  const logger = createChildLogger(baseLogger, { roleId, organizationId, userId });
  if (!baseUrl) {
    logger.warn({ event: 'assign_user_role_api_missing' });
    return { success: false };
  }
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/users/${userId}/roles/assign`;
    logger.info({ event: 'assign_user_role_api_start', url });
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(authHeader),
      body: JSON.stringify({
        roleId,
        name: fullName,
        emailAddress,
        phoneNumber,
        profilePic,
      }),
    });
    if (!response.ok) {
      logger.warn({ event: 'assign_user_role_api_non_ok', status: response.status });
      return { success: false };
    }
    const body = (await response.json()) as any;
    logger.info({ event: 'assign_user_role_api_success' });
    return body?.data || body || { success: true };
  } catch (error) {
    logger.error({ event: 'assign_user_role_api_failed', err: serializeError(error) });
    return { success: false };
  }
};
