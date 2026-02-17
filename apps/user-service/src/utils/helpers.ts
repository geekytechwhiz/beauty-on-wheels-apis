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

