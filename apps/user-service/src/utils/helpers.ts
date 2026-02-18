import { randomUUID } from 'crypto';
import type { APIGatewayProxyEvent } from 'aws-lambda';

export const getCorrelationId = (headers: Record<string, string | undefined>): string =>
  headers['x-correlation-id'] || headers['X-Correlation-ID'] || randomUUID();

export const generateFileId = (): string => randomUUID();

/**
 * Extract user ID from API Gateway authorizer context.
 * Supports authorizer.userID, authorizer.userId, and authorizer['custom:userID'] (no claims object required).
 */
export function getAuthorizerUserId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  console.log('authorizer', authorizer);
  return (authorizer?.userID ?? authorizer?.userId ?? authorizer?.claims?.['custom:userID']) as string | undefined;
}

/**
 * Extract organization ID from API Gateway authorizer context.
 * Supports authorizer.organizationID, authorizer.organizationId, and authorizer['custom:organizationID'] (no claims object required).
 */
export function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  console.log('authorizer', authorizer);
  return (authorizer?.organizationID ?? authorizer?.organizationId ?? authorizer?.claims?.['custom:organizationID']) as string | undefined;
}

/**
 * Decode Cognito JWT from Authorization header and extract userId, organizationId (and sub for Cognito lookup).
 * Used when authorizer context does not provide these (e.g. searchFnF with pool-specific tokens).
 */
export function getUserIdAndOrganizationIdFromToken(authHeader: string | undefined): {
  userId?: string;
  organizationId?: string;
  sub?: string;
} {
  if (!authHeader || typeof authHeader !== 'string') return {};
  try {
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const base64Url = token.split('.')[1];
    if (!base64Url) return {};
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload) as Record<string, unknown>;
    return {
      userId:
        (decoded['custom:userID'] as string) ??
        (decoded['custom:userId'] as string) ??
        (decoded.userID as string) ??
        (decoded.userId as string),
      organizationId:
        (decoded['custom:organizationID'] as string) ??
        (decoded['custom:organizationId'] as string) ??
        (decoded.organizationID as string) ??
        (decoded.organizationId as string),
      sub: decoded.sub as string,
    };
  } catch {
    return {};
  }
}

