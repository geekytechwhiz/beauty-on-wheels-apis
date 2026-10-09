import { resolveApplicationRoles } from '@api-hub/authentication-core';
import { createLogger } from '@api-hub/observability';

import {
  loadApplicationTokenClaimsForIdentity,
  type ApplicationTokenClaims,
} from './access-token-roles';

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
 * Application claims are added only to the access token. Existing overrides,
 * including any ID-token overrides, are kept. Cognito's `sub` is left untouched.
 */
export function accessTokenClaimsResponse(
  claims: ApplicationTokenClaims,
  existing?: PreTokenGenerationEvent['response'],
): PreTokenGenerationEvent['response'] {
  const current = (existing ?? {}) as {
    claimsAndScopeOverrideDetails?: ClaimsAndScopeOverrideDetails;
  };
  const details = current.claimsAndScopeOverrideDetails ?? {};
  const access = details.accessTokenGeneration ?? {};
  const roles = resolveApplicationRoles(claims.roles);
  // A scalar role is retained for existing frontend consumers. Prefer the
  // most privileged persisted role while `roles` preserves the full set.
  const role = roles.includes('ADMIN')
    ? 'ADMIN'
    : roles.includes('VENDOR')
      ? 'VENDOR'
      : roles.includes('CUSTOMER')
        ? 'CUSTOMER'
        : undefined;

  return {
    ...current,
    claimsAndScopeOverrideDetails: {
      ...details,
      accessTokenGeneration: {
        ...access,
        claimsToAddOrOverride: {
          ...(access.claimsToAddOrOverride ?? {}),
          ...(claims.identityId ? { identityId: claims.identityId } : {}),
          ...(claims.userType ? { userType: claims.userType } : {}),
          ...(role ? { role } : {}),
          ...(roles.length > 0 ? { roles } : {}),
        },
      },
    },
  };
}

/** @deprecated Use accessTokenClaimsResponse with persisted userType. */
export function accessTokenRolesResponse(
  roles: string[],
  existing?: PreTokenGenerationEvent['response'],
): PreTokenGenerationEvent['response'] {
  const current = (existing ?? {}) as {
    claimsAndScopeOverrideDetails?: ClaimsAndScopeOverrideDetails;
  };
  const details = current.claimsAndScopeOverrideDetails ?? {};
  const access = details.accessTokenGeneration ?? {};
  return {
    ...current,
    claimsAndScopeOverrideDetails: {
      ...details,
      accessTokenGeneration: {
        ...access,
        claimsToAddOrOverride: {
          ...(access.claimsToAddOrOverride ?? {}),
          roles: resolveApplicationRoles(roles),
        },
      },
    },
  };
}

export async function applyApplicationRoles(
  event: PreTokenGenerationEvent,
  resolveClaims: (
    identityId: string,
  ) => Promise<ApplicationTokenClaims | string[]>,
): Promise<PreTokenGenerationEvent> {
  const identityId = event.request?.userAttributes?.sub?.trim();
  logger.info({
    event: 'pre_token_generation_invoked',
    triggerVersion: event.version,
    triggerSource: event.triggerSource,
  });
  if (!identityId) {
    logger.warn({
      event: 'pre_token_generation_missing_sub',
      triggerVersion: event.version,
      triggerSource: event.triggerSource,
    });
    return event;
  }

  let claims: ApplicationTokenClaims;
  let usingLegacyRoleResolver = false;
  try {
    const resolved = await resolveClaims(identityId);
    // Keep this narrow compatibility shim for direct callers of the original
    // helper. Production issuance always resolves the richer persisted shape.
    if (Array.isArray(resolved)) {
      usingLegacyRoleResolver = true;
      claims = { roles: resolved };
    } else {
      claims = resolved;
    }
  } catch (err) {
    // Fail open for issuance: Cognito still returns a token, but without an
    // application `roles` claim. The claim is never defaulted and is never set
    // to ADMIN. API authorization re-reads Identity and denies the call when
    // that read fails, so a lookup error cannot grant a privilege.
    logger.warn({
      event: 'pre_token_generation_role_lookup_failed',
      triggerVersion: event.version,
      triggerSource: event.triggerSource,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return event;
  }

  const roles = resolveApplicationRoles(claims.roles);
  if (roles.length === 0 && !claims.userType) {
    logger.info({
      event: 'pre_token_generation_no_roles',
      roleCount: 0,
      triggerVersion: event.version,
      triggerSource: event.triggerSource,
    });
    return event;
  }

  const result = {
    ...event,
    response: usingLegacyRoleResolver
      ? accessTokenRolesResponse(roles, event.response)
      : accessTokenClaimsResponse({ ...claims, roles }, event.response),
  };
  logger.info({
    event: 'pre_token_generation_claims_applied',
    roleCount: roles.length,
    triggerVersion: event.version,
    triggerSource: event.triggerSource,
  });
  return result;
}

export async function customizeAccessToken(
  event: PreTokenGenerationEvent,
): Promise<PreTokenGenerationEvent> {
  return applyApplicationRoles(event, (identityId) =>
    loadApplicationTokenClaimsForIdentity(identityId),
  );
}
