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
    const url = `${baseUrl.replace(/\/$/, '')}/org/${organizationId}/roles/${roleId}/permissions`;
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
