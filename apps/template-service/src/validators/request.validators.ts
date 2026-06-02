import { LambdaRequest } from '@api-hub/utils';
import { TEMPLATE_STATUS, TemplateEntityBuilder } from '@api-hub/template-core';

import { getActorUserIdForRequest, getOrganizationIdForRequest } from '../utils/helpers';
import {
  cloneTemplateBodySchema,
  orgClonePathSchema,
  orgTemplatePathSchema,
  parseGetMasterVersionsQuery,
  parseListMasterTemplatesQuery,
  parseListOrgTemplatesQuery,
  templateIdPathSchema,
  templateVersionPathSchema,
  createOrgEnablementBodySchema,
  enablementIdPathSchema,
  orgEnablementOrgPathSchema,
  parseSearchOrgEnablementsQuery,
  updateOrgEnablementBodySchema,
  type CloneTemplateBody,
  type CreateMasterTemplateBody,
  type CreateOrgEnablementBody,
  type SearchOrgEnablementsQuery,
  type UpdateOrgEnablementBody,
  parseListCompatibleTemplatesQuery,
  type ListCompatibleTemplatesQuery,
  type UpdateOrgTemplateBody,
  updateOrgTemplateBodySchema,
  type GetMasterVersionsQuery,
  type ListMasterTemplatesQuery,
  type ListOrgTemplatesQuery,
  type StatusTransitionBody,
  type UpdateMasterTemplateBody,
  listTemplateConfigQuerySchema,
  templateConfigIdPathSchema,
} from './template.schemas';

function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  throw err;
}

export type ValidatedCreateMaster = {
  actorUserId: string;
  body: CreateMasterTemplateBody & {
    templateCode: string;
    templateName: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseUiMetaBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throwVal('UI meta request body must be a JSON object', 400, 'VALIDATION_ERROR');
    } catch {
      throwVal('Invalid JSON body for UI meta upsert', 400, 'VALIDATION_ERROR');
    }
  }
  throwVal('UI meta request body is required', 400, 'VALIDATION_ERROR');
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return undefined;
}

function normalizeStatus(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const canonical = raw.trim().replace(/\s+/g, '_').toUpperCase();
  if (canonical in TEMPLATE_STATUS) return canonical;
  return undefined;
}

function normalizeStatusOrThrow(raw: unknown, fieldName: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const normalized = normalizeStatus(raw);
  if (!normalized) {
    throwVal(`Invalid ${fieldName}. Allowed values: ${Object.keys(TEMPLATE_STATUS).join(', ')}`);
  }
  return normalized;
}

/** Match create flow: templateCode → templateId (uppercase, underscores → hyphens). */
function normalizePathTemplateId(templateId: string): string {
  return TemplateEntityBuilder.normalizeTemplateId(templateId);
}

function normalizeCreateMasterBody(rawBody: unknown): CreateMasterTemplateBody & {
  templateCode: string;
  templateName: string;
} {
  const body = asRecord(rawBody);
  const templateMetadata = asRecord(body.templateMetadata);
  const templateProfile = asRecord(body.templateProfile);

  const templateCode = firstString(body.templateCode);
  const templateName = firstString(body.templateName) ?? firstString(templateMetadata.templateName);
  const templateType = firstString(body.templateType);
  const templateDescription =
    firstString(body.templateDescription) ?? firstString(templateMetadata.templateDescription);
  const status = normalizeStatus(body.status) ?? normalizeStatus(templateMetadata.status);

  const versionRaw = body.version ?? templateMetadata.version;
  const version =
    typeof versionRaw === 'number' && Number.isFinite(versionRaw) && versionRaw > 0
      ? Math.trunc(versionRaw)
      : undefined;

  const createdBy =
    firstString(body.createdBy) ??
    firstString(templateMetadata.createdBy) ??
    firstString(templateMetadata.lastModifiedBy);

  const normalized: CreateMasterTemplateBody & { templateCode: string; templateName: string } = {
    ...body,
    templateCode: templateCode ?? '',
    templateName: templateName ?? '',
    ...(templateType ? { templateType } : {}),
    ...(templateDescription ? { templateDescription } : {}),
    ...(status ? { status } : {}),
    ...(version ? { version } : {}),
    ...(createdBy ? { createdBy } : {}),
    category: body.category ?? templateProfile.category,
    condition: body.condition ?? templateProfile.condition,
    conditions: asStringArray(body.conditions),
    countries: asStringArray(body.countries ?? templateProfile.country),
    languages: asStringArray(body.languages ?? templateProfile.language),
    specialty: asStringArray(body.specialty ?? templateProfile.specialty),
    specialties: asStringArray(body.specialties),
  };

  if (!normalized.templateCode) {
    throwVal('templateCode is required', 400, 'VALIDATION_ERROR');
  }
  if (!normalized.templateName) {
    throwVal('templateName is required (or templateMetadata.templateName)', 400, 'VALIDATION_ERROR');
  }

  return normalized;
}

export type ValidatedListMaster = {
  query: ListMasterTemplatesQuery;
  actorUserId: string;
};

export type ValidatedGetMasterVersions = {
  templateId: string;
  query: GetMasterVersionsQuery;
  actorUserId: string;
};

export type ValidatedTemplateVersionPath = {
  templateId: string;
  versionId: string;
  actorUserId: string;
};

export type ValidatedUpdateMasterVersion = ValidatedTemplateVersionPath & {
  body: UpdateMasterTemplateBody;
};

export type ValidatedStatusTransition = ValidatedTemplateVersionPath & {
  body: StatusTransitionBody;
  /** Set when caller is org-scoped (JWT org or explicit query). Used to route org vs master transition. */
  organizationId?: string;
};

async function validateActorAndVersionPath(
  req: LambdaRequest,
): Promise<ValidatedTemplateVersionPath> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = templateVersionPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('templateId and versionId are required', 400, 'VALIDATION_ERROR');
  }

  return {
    templateId: normalizePathTemplateId(path.data.templateId),
    versionId: path.data.versionId,
    actorUserId,
  };
}

export async function validateCreateMasterRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  (req as LambdaRequest & { validatedCreateMaster?: ValidatedCreateMaster }).validatedCreateMaster = {
    actorUserId,
    body: normalizeCreateMasterBody(req.body),
  };
}

export async function validateListMasterRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const rawQuery = parseListMasterTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );
  const query: ListMasterTemplatesQuery = {
    ...rawQuery,
    status: normalizeStatusOrThrow(rawQuery.status, 'status'),
  };

  (req as LambdaRequest & { validatedListMaster?: ValidatedListMaster }).validatedListMaster = {
    query,
    actorUserId,
  };
}

export async function validateGetMasterVersionsRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = templateIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('templateId is required', 400, 'VALIDATION_ERROR');
  }

  const rawQuery = parseGetMasterVersionsQuery(
    req.event.queryStringParameters as Record<string, string | string[] | undefined> | null,
  );
  const query: GetMasterVersionsQuery = {
    ...rawQuery,
    status: normalizeStatusOrThrow(rawQuery.status, 'status'),
  };

  (req as LambdaRequest & { validatedGetMasterVersions?: ValidatedGetMasterVersions }).validatedGetMasterVersions =
    {
      templateId: normalizePathTemplateId(path.data.templateId),
      query,
      actorUserId,
    };
}

export async function validateUpdateMasterVersionRequest(req: LambdaRequest): Promise<void> {
  const base = await validateActorAndVersionPath(req);
  (req as LambdaRequest & { validatedUpdateMasterVersion?: ValidatedUpdateMasterVersion }).validatedUpdateMasterVersion =
    {
      ...base,
      body: req.body as UpdateMasterTemplateBody,
    };
}

export async function validateStatusTransitionRequest(req: LambdaRequest): Promise<void> {
  const base = await validateActorAndVersionPath(req);
  const authHeader = req.context.authHeader;
  const orgFromQuery = firstString(
    (req.event.queryStringParameters as Record<string, string | undefined> | null)?.organizationId,
  );
  let organizationId: string | undefined;
  if (orgFromQuery) {
    organizationId = resolveOrganizationId(req, orgFromQuery);
  } else {
    const fromToken = getOrganizationIdForRequest(req.event, authHeader);
    const tokenOrg = fromToken?.trim();
    if (tokenOrg && tokenOrg.toUpperCase() !== 'ROOT') {
      organizationId = tokenOrg;
    }
  }

  (req as LambdaRequest & { validatedStatusTransition?: ValidatedStatusTransition }).validatedStatusTransition = {
    ...base,
    body: req.body as StatusTransitionBody,
    organizationId,
  };
}

function resolveOrganizationId(
  req: LambdaRequest,
  pathOrganizationId?: string,
): string {
  const authHeader = req.context.authHeader;
  const fromToken = getOrganizationIdForRequest(req.event, authHeader);
  const orgId = pathOrganizationId?.trim() || fromToken?.trim();

  if (!orgId) {
    throwVal('organizationId is required (path or auth token)', 400, 'VALIDATION_ERROR');
  }

  const isPlatformRoot = fromToken?.toUpperCase() === 'ROOT';
  if (fromToken && !isPlatformRoot && pathOrganizationId && pathOrganizationId !== fromToken) {
    throwVal('organizationId does not match authenticated organization', 403, 'FORBIDDEN');
  }

  return orgId;
}

export type ValidatedCloneOrgTemplate = {
  organizationId: string;
  templateId: string;
  versionId: string;
  actorUserId: string;
  body?: CloneTemplateBody;
};

export type ValidatedGetOrgVersions = {
  organizationId: string;
  templateId: string;
  query: GetMasterVersionsQuery;
  actorUserId: string;
};

export type ValidatedListOrg = {
  organizationId: string;
  query: ListOrgTemplatesQuery;
  actorUserId: string;
};

export async function validateCloneOrgTemplateRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = orgClonePathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('organizationId, templateId, and versionId are required', 400, 'VALIDATION_ERROR');
  }

  const organizationId = resolveOrganizationId(req, path.data.organizationId);
  const body = req.body
    ? cloneTemplateBodySchema.parse(req.body)
    : undefined;

  (req as LambdaRequest & { validatedCloneOrgTemplate?: ValidatedCloneOrgTemplate }).validatedCloneOrgTemplate =
    {
      organizationId,
      templateId: normalizePathTemplateId(path.data.templateId),
      versionId: path.data.versionId,
      actorUserId,
      body,
    };
}

export async function validateGetOrgVersionsRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = orgTemplatePathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('organizationId and templateId are required', 400, 'VALIDATION_ERROR');
  }

  const organizationId = resolveOrganizationId(req, path.data.organizationId);
  const rawQuery = parseGetMasterVersionsQuery(
    req.event.queryStringParameters as Record<string, string | string[] | undefined> | null,
  );
  const query: GetMasterVersionsQuery = {
    ...rawQuery,
    status: normalizeStatusOrThrow(rawQuery.status, 'status'),
  };

  (req as LambdaRequest & { validatedGetOrgVersions?: ValidatedGetOrgVersions }).validatedGetOrgVersions =
    {
      organizationId,
      templateId: normalizePathTemplateId(path.data.templateId),
      query,
      actorUserId,
    };
}

export async function validateListOrgTemplatesRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const rawQuery = parseListOrgTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );
  const query: ListOrgTemplatesQuery = {
    ...rawQuery,
    status: normalizeStatusOrThrow(rawQuery.status, 'status'),
  };
  const organizationId = resolveOrganizationId(req, query.organizationId);

  (req as LambdaRequest & { validatedListOrg?: ValidatedListOrg }).validatedListOrg = {
    organizationId,
    query,
    actorUserId,
  };
}

export type ValidatedUpdateOrgVersion = ValidatedTemplateVersionPath & {
  organizationId: string;
  body: UpdateOrgTemplateBody;
};

export type ValidatedCreateEnablement = {
  actorUserId: string;
  body: CreateOrgEnablementBody;
};

export type ValidatedListCompatible = {
  query: ListCompatibleTemplatesQuery;
  actorUserId: string;
};

export async function validateUpdateOrgTemplateVersionRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = templateVersionPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('templateId and versionId are required', 400, 'VALIDATION_ERROR');
  }

  const organizationId = resolveOrganizationId(req);
  const body = updateOrgTemplateBodySchema.parse(req.body ?? {});

  (req as LambdaRequest & { validatedUpdateOrgVersion?: ValidatedUpdateOrgVersion }).validatedUpdateOrgVersion =
    {
      templateId: normalizePathTemplateId(path.data.templateId),
      versionId: path.data.versionId,
      organizationId,
      actorUserId,
      body,
    };
}

export async function validateCreateOrgEnablementRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const body = createOrgEnablementBodySchema.parse(req.body ?? {});
  resolveOrganizationId(req, body.organizationId);

  (req as LambdaRequest & { validatedCreateEnablement?: ValidatedCreateEnablement }).validatedCreateEnablement =
    {
      actorUserId,
      body,
    };
}

export type ValidatedSearchEnablements = {
  query: SearchOrgEnablementsQuery;
  actorUserId: string;
};

export type ValidatedListEnablementsByOrg = {
  organizationId: string;
  actorUserId: string;
};

export type ValidatedGetEnablement = {
  enablementId: string;
  actorUserId: string;
};

export type ValidatedPatchEnablement = {
  enablementId: string;
  body: UpdateOrgEnablementBody;
  actorUserId: string;
};

export async function validateSearchOrgEnablementsRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const query = parseSearchOrgEnablementsQuery(
    req.params as Record<string, string | string[] | undefined>,
  );

  const fromToken = getOrganizationIdForRequest(req.event, authHeader);
  const isRoot = fromToken?.toUpperCase() === 'ROOT';
  let organizationId = query.organizationId;

  if (!organizationId?.trim() && !query.masterTemplateVersionId?.trim()) {
    if (!fromToken || isRoot) {
      throwVal(
        'organizationId or masterTemplateVersionId query parameter is required',
        400,
        'VALIDATION_ERROR',
      );
    }
    organizationId = fromToken;
  }

  if (organizationId?.trim()) {
    resolveOrganizationId(req, organizationId);
  }

  (req as LambdaRequest & { validatedSearchEnablements?: ValidatedSearchEnablements }).validatedSearchEnablements =
    {
      query: { ...query, organizationId },
      actorUserId,
    };
}

export async function validateListOrgEnablementsByOrgRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = orgEnablementOrgPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('orgId is required', 400, 'VALIDATION_ERROR');
  }

  const organizationId = resolveOrganizationId(req, path.data.orgId);

  (req as LambdaRequest & { validatedListEnablementsByOrg?: ValidatedListEnablementsByOrg })
    .validatedListEnablementsByOrg = {
    organizationId,
    actorUserId,
  };
}

export async function validateGetOrgEnablementRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = enablementIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('enablementId is required', 400, 'VALIDATION_ERROR');
  }

  (req as LambdaRequest & { validatedGetEnablement?: ValidatedGetEnablement }).validatedGetEnablement =
    {
      enablementId: path.data.enablementId,
      actorUserId,
    };
}

export async function validatePatchOrgEnablementRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = enablementIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('enablementId is required', 400, 'VALIDATION_ERROR');
  }

  const body = updateOrgEnablementBodySchema.parse(req.body ?? {});

  (req as LambdaRequest & { validatedPatchEnablement?: ValidatedPatchEnablement }).validatedPatchEnablement =
    {
      enablementId: path.data.enablementId,
      body,
      actorUserId,
    };
}

export type ValidatedListTemplateConfigs = {
  configType?: string;
  templateType?: string;
  actorUserId: string;
};

export type ValidatedGetTemplateConfig = {
  configId: string;
  actorUserId: string;
};

export type ValidatedCreateTemplateConfig = {
  body: Record<string, unknown>;
  actorUserId: string;
};

export type ValidatedUpdateTemplateConfig = {
  configId: string;
  body: Record<string, unknown>;
  actorUserId: string;
};

async function validateActor(req: LambdaRequest): Promise<string> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }
  return actorUserId;
}

function parseQueryParams(
  params: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return out;
}

export async function validateListTemplateConfigsRequest(req: LambdaRequest): Promise<void> {
  const actorUserId = await validateActor(req);
  const query = listTemplateConfigQuerySchema.safeParse(
    parseQueryParams(req.params as Record<string, string | string[] | undefined>),
  );
  if (!query.success) {
    throwVal('Invalid list query parameters', 400, 'VALIDATION_ERROR');
  }
  (
    req as LambdaRequest & { validatedListTemplateConfigs?: ValidatedListTemplateConfigs }
  ).validatedListTemplateConfigs = {
    configType: query.data.configType,
    templateType: query.data.templateType,
    actorUserId,
  };
}

export async function validateGetTemplateConfigRequest(req: LambdaRequest): Promise<void> {
  const actorUserId = await validateActor(req);
  const path = templateConfigIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('configId is required', 400, 'VALIDATION_ERROR');
  }
  (
    req as LambdaRequest & { validatedGetTemplateConfig?: ValidatedGetTemplateConfig }
  ).validatedGetTemplateConfig = { configId: path.data.configId, actorUserId };
}

export async function validateCreateTemplateConfigRequest(req: LambdaRequest): Promise<void> {
  const actorUserId = await validateActor(req);
  (
    req as LambdaRequest & { validatedCreateTemplateConfig?: ValidatedCreateTemplateConfig }
  ).validatedCreateTemplateConfig = {
    body: parseUiMetaBody(req.body),
    actorUserId,
  };
}

export async function validateUpdateTemplateConfigRequest(req: LambdaRequest): Promise<void> {
  const actorUserId = await validateActor(req);
  const path = templateConfigIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('configId is required', 400, 'VALIDATION_ERROR');
  }
  (
    req as LambdaRequest & { validatedUpdateTemplateConfig?: ValidatedUpdateTemplateConfig }
  ).validatedUpdateTemplateConfig = {
    configId: path.data.configId,
    body: parseUiMetaBody(req.body),
    actorUserId,
  };
}

export async function validateListCompatibleTemplatesRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const query = parseListCompatibleTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );

  (req as LambdaRequest & { validatedListCompatible?: ValidatedListCompatible }).validatedListCompatible =
    {
      query,
      actorUserId,
    };
}

