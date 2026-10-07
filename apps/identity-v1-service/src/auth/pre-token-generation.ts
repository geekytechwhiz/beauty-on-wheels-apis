import { createLogger } from '@api-hub/observability';

import { loadApplicationRolesForIdentity } from './access-token-roles';

const logger = createLogger({
  service: 'identity-pre-token-generation',
  redactPII: true,
});

export interface PreTokenGenerationEvent {
  version?: string;
  triggerSource?: string;
  userName?: string;
  request?: {
    userAttributes?: Record<string, string | undefined>;
    scopes?: string[];
  };
  response?: Record<string, unknown>;
}

/**
 * Cognito Pre Token Generation (event version 2) response fragment.
 * `roles` is an array of application role codes. `sub` is left untouched.
 */
export function accessTokenRolesResponse(roles: string[]): PreTokenGenerationEvent['response'] {
  return {
    claimsAndScopeOverrideDetails: {
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          roles,
        },
      },
    },
  };
}

export async function applyApplicationRoles(
  event: PreTokenGenerationEvent,
  resolveRoles: (identityId: string) => Promise<string[]>,
): Promise<PreTokenGenerationEvent> {
  const identityId = event.request?.userAttributes?.sub?.trim();
  if (!identityId) {
    return event;
  }

  let roles: string[] = [];
  try {
    roles = await resolveRoles(identityId);
  } catch (err) {
    logger.warn({
      event: 'access_token_roles_unresolved',
      error: err instanceof Error ? err.message : 'unknown',
    });
    return event;
  }

  if (roles.length === 0) {
    return event;
  }

  return {
    ...event,
    response: accessTokenRolesResponse(roles),
  };
}

export async function customizeAccessToken(
  event: PreTokenGenerationEvent,
): Promise<PreTokenGenerationEvent> {
  return applyApplicationRoles(event, (identityId) =>
    loadApplicationRolesForIdentity(identityId),
  );
}
