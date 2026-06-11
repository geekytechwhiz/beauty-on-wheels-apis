import type { APIGatewayProxyEvent } from 'aws-lambda';

export function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/** Coerce JSON string/number to number; preserves 0. Returns undefined for null/empty/missing. */
export function coerceOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Target user for device pairing (DEVICE_LIST#userId).
 * Per-device userId/userID wins so staff can register for a patient.
 */
export function resolveRegisterUserId(
  device: Record<string, unknown> | undefined,
  requestBody: Record<string, unknown>,
  authorizerUserId: string | undefined,
): string | undefined {
  return (
    pickString(device?.userId, device?.userID, requestBody.userId, requestBody.userID) ??
    authorizerUserId
  );
}

/**
 * Extract user ID from API Gateway authorizer context.
 * Supports authorizer.userID, authorizer.userId, and authorizer.claims['custom:userID'].
 * Also falls back to decoding JWT token from Authorization header if authorizer context is not available.
 */
export function getAuthorizerUserId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  
  // Try authorizer context first (most common case)
  const userIdFromAuthorizer = 
    authorizer?.userID ?? 
    authorizer?.userId ?? 
    authorizer?.claims?.['custom:userID'] ?? 
    authorizer?.claims?.['custom:userId'];
  
  if (userIdFromAuthorizer) {
    return userIdFromAuthorizer as string;
  }
  
  // Fallback: Try to decode JWT token from Authorization header
  const authHeader = 
    event.headers?.Authorization || 
    event.headers?.authorization || 
    event.headers?.AUTHORIZATION;
  
  if (authHeader) {
    try {
      const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
      const base64Url = token.split('.')[1];
      if (base64Url) {
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          Buffer.from(base64, 'base64')
            .toString()
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const decoded = JSON.parse(jsonPayload) as Record<string, unknown>;
        return (
          (decoded['custom:userID'] as string) ??
          (decoded['custom:userId'] as string) ??
          (decoded.userID as string) ??
          (decoded.userId as string)
        );
      }
    } catch {
      // Silently fail if token decoding fails
    }
  }
  
  return undefined;
}

/**
 * Resolve target user for POST /devices/list user-device queries (DEVICE_LIST#userId).
 * Legacy retrieve-device-list used body `userID` only; explicit body user wins over JWT
 * so staff can load a patient's paired devices.
 */
export function resolveDeviceListUserId(
  event: APIGatewayProxyEvent,
  requestData: Record<string, unknown>,
): string | undefined {
  const userIdFromBody =
    pickString(requestData.userId, requestData.userID);

  return userIdFromBody || getAuthorizerUserId(event);
}

/**
 * Extract organization ID from API Gateway authorizer context.
 * Supports authorizer.organizationID, authorizer.organizationId, and authorizer.claims['custom:organizationID'].
 * Also falls back to decoding JWT token from Authorization header if authorizer context is not available.
 */
export function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  
  // Try authorizer context first (most common case)
  const orgIdFromAuthorizer = 
    authorizer?.organizationID ?? 
    authorizer?.organizationId ?? 
    authorizer?.claims?.['custom:organizationID'] ?? 
    authorizer?.claims?.['custom:organizationId'];
  
  if (orgIdFromAuthorizer) {
    return orgIdFromAuthorizer as string;
  }
  
  // Fallback: Try to decode JWT token from Authorization header
  const authHeader = 
    event.headers?.Authorization || 
    event.headers?.authorization || 
    event.headers?.AUTHORIZATION;
  
  if (authHeader) {
    try {
      const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
      const base64Url = token.split('.')[1];
      if (base64Url) {
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          Buffer.from(base64, 'base64')
            .toString()
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const decoded = JSON.parse(jsonPayload) as Record<string, unknown>;
        return (
          (decoded['custom:organizationID'] as string) ??
          (decoded['custom:organizationId'] as string) ??
          (decoded.organizationID as string) ??
          (decoded.organizationId as string)
        );
      }
    } catch {
      // Silently fail if token decoding fails
    }
  }
  
  return undefined;
}
