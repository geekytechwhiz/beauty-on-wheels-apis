import { LambdaRequest, decodeJwtPayload, BaseError } from '@api-hub/utils';
import type { FhirAction } from '@api-hub/scope-mapping';
import { isScopeAllowed } from '@api-hub/scope-mapping';

export interface FhirGatewayContext {
  tenantId?: string;
  scopes: string[];
  token?: Record<string, unknown>;
  clientId?: string;
}

export type FhirRequest<
  Params = Record<string, any>,
  Body = any,
  Query = Record<string, any>
> = LambdaRequest<Params, Body, Query> & {
  fhir?: FhirGatewayContext;
};

function extractScopesFromToken(token: any): string[] {
  if (!token) return [];
  const raw: string | string[] | undefined = token.scope ?? token.scp;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveTenantId(token: any, existingTenant?: string): string | undefined {
  if (!token && !existingTenant) return undefined;
  return (
    token?.['custom:tenantID'] ??
    token?.tenantId ??
    token?.tenantID ??
    token?.['custom:organizationID'] ??
    token?.organizationId ??
    existingTenant
  );
}

function resolveClientId(token: any): string | undefined {
  return (
    token?.clientId ??
    token?.client_id ??
    token?.['custom:clientID'] ??
    token?.['custom:clientId']
  );
}

export const createFhirGatewayValidator =
  (resourceType: string, action: FhirAction) =>
  async (req: FhirRequest): Promise<void> => {
    const authHeader = req.context.authHeader;
    if (!authHeader) {
      throw new BaseError(
        'Missing Authorization header',
        401,
        'UNAUTHENTICATED'
      );
    }

    const token = decodeJwtPayload(authHeader);
    const scopes = extractScopesFromToken(token);

    if (!isScopeAllowed(scopes, resourceType, action)) {
      throw new BaseError(
        `Insufficient scope for ${resourceType} ${action}`,
        403,
        'INSUFFICIENT_SCOPE'
      );
    }

    const tenantId = resolveTenantId(
      token,
      req.context.userContext?.organizationId
    );

    const clientId = resolveClientId(token);

    req.context.userContext = {
      ...(req.context.userContext ?? {}),
      organizationId: tenantId ?? req.context.userContext?.organizationId,
    };

    req.fhir = {
      tenantId,
      scopes,
      token,
      clientId,
    };
  };

