import type { APIGatewayProxyEvent } from 'aws-lambda';

import type { ValidUserContext } from '../types/deviceRegistration.types';
import { getAuthorizerOrganizationId, getAuthorizerUserId } from './helpers';

/**
 * User context extracted from API Gateway authorizer (Cognito) or request body.
 * Used for device registration and other authenticated operations.
 */
export interface UserContext {
  userId: string | undefined;
  organizationId: string | undefined;
}

/** Input for extractUserContext. */
export interface ExtractUserContextInput {
  authorizer: unknown;
  body: Record<string, unknown>;
  /** When provided, falls back to JWT claims in Authorization header. */
  event?: APIGatewayProxyEvent;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Extracts Cognito (or authorizer) claims from the event.
 * Merges top-level authorizer context with nested claims — API Gateway often sets
 * organizationID/userID on the authorizer root while user claims live under claims.
 *
 * @param authorizer - event.requestContext.authorizer
 * @returns Claims record (possibly empty)
 */
export function extractCognitoContext(authorizer: unknown): Record<string, unknown> {
  const auth =
    authorizer && typeof authorizer === 'object'
      ? (authorizer as Record<string, unknown>)
      : {};
  const nestedClaims =
    auth.claims && typeof auth.claims === 'object'
      ? (auth.claims as Record<string, unknown>)
      : {};

  return { ...nestedClaims, ...auth };
}

/**
 * Extracts userId and organizationId from authorizer (root + claims), body, or JWT.
 *
 * @param input - authorizer, parsed body, and optional API Gateway event
 * @returns UserContext with userId and organizationId (may be undefined)
 */
export function extractUserContext(input: ExtractUserContextInput): UserContext {
  const { authorizer, body, event } = input;
  const auth =
    authorizer && typeof authorizer === 'object'
      ? (authorizer as Record<string, unknown>)
      : {};
  const claims =
    auth.claims && typeof auth.claims === 'object'
      ? (auth.claims as Record<string, unknown>)
      : {};

  let userId = pickString(
    auth.userID,
    auth.userId,
    claims['custom:userID'],
    claims['custom:userId'],
    claims.userID,
    claims.userId,
    claims.sub,
    body.userId,
    body.userID,
  );

  let organizationId = pickString(
    auth.organizationID,
    auth.organizationId,
    claims['custom:organizationID'],
    claims['custom:organizationId'],
    claims.organizationID,
    claims.organizationId,
    body.organizationId,
    body.organizationID,
  );

  if (event) {
    userId = userId ?? getAuthorizerUserId(event);
    organizationId = organizationId ?? getAuthorizerOrganizationId(event);
  }

  return { userId, organizationId };
}

/**
 * Validates that user context has required fields for device registration.
 *
 * @param context - UserContext from extractUserContext
 * @returns True if both userId and organizationId are non-empty strings
 */
export function validateUserContext(context: UserContext): context is ValidUserContext {
  return (
    typeof context.userId === 'string' &&
    context.userId.length > 0 &&
    typeof context.organizationId === 'string' &&
    context.organizationId.length > 0
  );
}
