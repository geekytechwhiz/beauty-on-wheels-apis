import type { LambdaRequest } from '@api-hub/utils';

import { getOrganizationIdForRequest } from '../utils/helpers';

export type TemplateLevel = 'MASTER' | 'ORG' | 'ORG_DERIVED' | 'ORG_CARE_PLAN';

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

function normalizeTemplateLevel(value: string | undefined): TemplateLevel | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === 'ORG_DERIVED' ||
    normalized === 'ORG_CARE_PLAN' ||
    normalized === 'ORG' ||
    normalized === 'MASTER'
  ) {
    return normalized as TemplateLevel;
  }
  return undefined;
}

export function isOrgDerivedListLevel(level: TemplateLevel): boolean {
  return level === 'ORG_DERIVED' || level === 'ORG_CARE_PLAN';
}

/** Resolve MASTER vs ORG vs org-derived list levels for unified /templates routes. */
export function resolveTemplateLevelFromQuery(req: LambdaRequest): TemplateLevel {
  const explicit = normalizeTemplateLevel(firstQuery(req, 'templateLevel'));
  if (explicit) return explicit;

  const organizationId = firstQuery(req, 'organizationId');
  if (organizationId) return 'ORG';

  const authHeader = req.context.authHeader;
  const fromToken = getOrganizationIdForRequest(req.event, authHeader)?.trim();
  if (fromToken && fromToken.toUpperCase() !== 'ROOT') {
    return 'ORG';
  }

  return 'MASTER';
}

export function resolveTemplateLevelFromBody(body: unknown): TemplateLevel | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as Record<string, unknown>).templateLevel;
  if (typeof raw !== 'string') return undefined;
  return normalizeTemplateLevel(raw);
}
