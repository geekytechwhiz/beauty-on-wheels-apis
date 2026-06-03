import type { LambdaRequest } from '@api-hub/utils';

import { getOrganizationIdForRequest } from '../utils/helpers';

export type TemplateLevel = 'MASTER' | 'ORG';

function firstQuery(
  req: LambdaRequest,
  key: string,
): string | undefined {
  const fromParams = req.params?.[key];
  if (typeof fromParams === 'string' && fromParams.trim()) {
    return fromParams.trim();
  }
  const qs = req.event.queryStringParameters as Record<string, string | undefined> | null;
  const raw = qs?.[key];
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim().toUpperCase();
  }
  return undefined;
}

/** Resolve MASTER vs ORG for unified /templates routes. */
export function resolveTemplateLevelFromQuery(req: LambdaRequest): TemplateLevel {
  const explicit = firstQuery(req, 'templateLevel');
  if (explicit === 'ORG') return 'ORG';
  if (explicit === 'MASTER') return 'MASTER';

  const organizationId = firstQuery(req, 'organizationId');
  if (organizationId) return 'ORG';

  const authHeader = req.context.authHeader;
  const fromToken = getOrganizationIdForRequest(req.event, authHeader)?.trim();
  if (fromToken && fromToken.toUpperCase() !== 'ROOT') {
    return 'ORG';
  }

  return 'MASTER';
}
