import type { LambdaRequest } from '@api-hub/utils';

import { getOrganizationIdForRequest } from '../utils/helpers';

export type TemplateLevel = 'MASTER' | 'ORG' | 'ORG_DERIVED' | 'ORG_CARE_PLAN';

/** API Gateway / serverless-offline may lowercase query keys — map to canonical camelCase. */
const QUERY_PARAM_KEY_MAP: Record<string, string> = {
  templatelevel: 'templateLevel',
  organizationid: 'organizationId',
  organizationmetaid: 'organizationMetaId',
  orgtemplateid: 'orgTemplateId',
  organizationname: 'organizationName',
  organizationdescription: 'organizationDescription',
  categorycode: 'categoryCode',
  conditioncode: 'conditionCode',
  templatetype: 'templateType',
  templatename: 'templateName',
  templateid: 'templateId',
  templateenabled: 'templateEnabled',
  nextpaginationkey: 'nextPaginationKey',
  nexttoken: 'nextToken',
};

function canonicalQueryKey(key: string): string {
  return QUERY_PARAM_KEY_MAP[key.toLowerCase()] ?? key;
}

/** Merge path + query params with case-insensitive keys (later sources override earlier). */
export function collectTemplateQueryParams(
  sources: Array<Record<string, string | string[] | undefined> | null | undefined>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;
      const single = Array.isArray(value) ? value[0] : value;
      if (typeof single !== 'string' || !single.trim()) continue;
      merged[canonicalQueryKey(key)] = single.trim();
    }
  }
  return merged;
}

function firstQuery(req: LambdaRequest, key: string): string | undefined {
  const canonical = canonicalQueryKey(key);
  const collected = collectTemplateQueryParams([
    req.params as Record<string, string | string[] | undefined>,
    req.event.queryStringParameters as Record<string, string | string[] | undefined>,
  ]);
  return collected[canonical];
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
