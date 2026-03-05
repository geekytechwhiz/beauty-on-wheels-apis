import type { ValidUserContext } from '../types/deviceRegistration.types';

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
}

/**
 * Extracts Cognito (or authorizer) claims from the event.
 * Prefers authorizer.claims; falls back to authorizer object itself.
 *
 * @param authorizer - event.requestContext.authorizer
 * @returns Claims record (possibly empty)
 */
export function extractCognitoContext(authorizer: unknown): Record<string, unknown> {
  const claims = (authorizer as { claims?: Record<string, unknown> })?.claims
    ?? (authorizer as Record<string, unknown>)
    ?? {};
  return claims;
}

/**
 * Extracts userId and organizationId from authorizer claims (Cognito) or body.
 * Order: custom:userID, custom:userId, userID, userId, sub for userId;
 *        custom:organizationID, custom:organizationId, organizationID, organizationId for organizationId.
 *
 * @param input - authorizer and parsed body
 * @returns UserContext with userId and organizationId (may be undefined)
 */
export function extractUserContext(input: ExtractUserContextInput): UserContext {
  const { authorizer, body } = input;
  const claims = extractCognitoContext(authorizer);

  const userId =
    (claims['custom:userID'] as string) ||
    (claims['custom:userId'] as string) ||
    (claims.userID as string) ||
    (claims.userId as string) ||
    (claims.sub as string) ||
    (body.userId as string) ||
    (body.userID as string);

  const organizationId =
    (claims['custom:organizationID'] as string) ||
    (claims['custom:organizationId'] as string) ||
    (claims.organizationID as string) ||
    (claims.organizationId as string) ||
    (body.organizationId as string) ||
    (body.organizationID as string);

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
