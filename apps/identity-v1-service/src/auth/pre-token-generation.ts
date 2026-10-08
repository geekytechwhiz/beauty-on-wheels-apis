import { resolveApplicationRoles } from '@api-hub/authentication-core';
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

type AccessTokenGeneration = {
  claimsToAddOrOverride?: Record<string, unknown>;
  claimsToSuppress?: string[];
  scopesToAdd?: string[];
  scopesToSuppress?: string[];
};

type ClaimsAndScopeOverrideDetails = {
  idTokenGeneration?: {
    claimsToAddOrOverride?: Record<string, unknown>;
    claimsToSuppress?: string[];
  };
  accessTokenGeneration?: AccessTokenGeneration;
  groupOverrideDetails?: Record<string, unknown>;
};

/**
 * Cognito Pre Token Generation V2_0 response fragment.
 * `roles` is added only to the access token. Existing overrides, including any
 * ID-token overrides, are kept. `sub` is left untouched.
 */
export function accessTokenRolesResponse(
  roles: string[],
  existing?: PreTokenGenerationEvent['response'],
): PreTokenGenerationEvent['response'] {
  const current = (existing ?? {}) as {
    claimsAndScopeOverrideDetails?: ClaimsAndScopeOverrideDetails;
  };
  const details = current.claimsAndScopeOverrideDetails ?? {};
  const access = details.accessTokenGeneration ?? {};
  const canonical = resolveApplicationRoles(roles);

  return {
    ...current,
    claimsAndScopeOverrideDetails: {
      ...details,
      accessTokenGeneration: {
        ...access,
        claimsToAddOrOverride: {
          ...(access.claimsToAddOrOverride ?? {}),
          roles: canonical,
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
    roles = resolveApplicationRoles(await resolveRoles(identityId));
  } catch (err) {
    // Fail open for issuance: Cognito still returns a token, but without an
    // application `roles` claim. The claim is never defaulted and is never set
    // to ADMIN. API authorization re-reads Identity and denies the call when
    // that read fails, so a lookup error cannot grant a privilege.
    logger.warn({
      event: 'access_token_roles_unresolved',
      error: err instanceof Error ? err.name : 'unknown',
    });
    return event;
  }

  if (roles.length === 0) {
    return event;
  }

  return {
    ...event,
    response: accessTokenRolesResponse(roles, event.response),
  };
}

export async function customizeAccessToken(
  event: PreTokenGenerationEvent,
): Promise<PreTokenGenerationEvent> {
  return applyApplicationRoles(event, (identityId) =>
    loadApplicationRolesForIdentity(identityId),
  );
}
