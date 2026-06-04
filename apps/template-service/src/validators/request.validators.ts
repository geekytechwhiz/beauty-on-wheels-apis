import { LambdaRequest } from '@api-hub/utils';
import {
  normalizeShareScopeOrThrow,
  normalizeTemplateServiceError,
  TEMPLATE_STATUS,
  TemplateEntityBuilder,
  TemplateService,
  type TemplateActorUser,
} from '@api-hub/template-core';

import {
  getActorUserForRequest,
  getActorUserIdForRequest,
  getOrganizationIdForRequest,
} from '../utils/helpers';
import { enrichTemplateActorUser } from '../services/user-lookup.service';
import {
  cloneTemplateBodySchema,
  deriveTemplateBodySchema,
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
  saveMasterTemplateBodySchema,
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

let templateService: TemplateService | undefined;

function getTemplateService(): TemplateService {
  if (!templateService) templateService = new TemplateService();
  return templateService;
}

export type ValidatedCreateMaster = {
  actorUser: TemplateActorUser;
  body: CreateMasterTemplateBody & {
    templateCode: string;
    templateName: string;
  };
};

/** Auth only (list/read) — JWT actor, no USER_TABLE round-trip. */
function requireAuthenticatedActor(req: LambdaRequest): TemplateActorUser {
  const actorUser = getActorUserForRequest(req.event, req.context.authHeader);
  if (!actorUser?.userId?.trim()) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }
  return actorUser;
}

/** Mutations — JWT actor enriched from USER_TABLE (fullName, email). */
async function requireActorUser(req: LambdaRequest): Promise<TemplateActorUser> {
  return enrichTemplateActorUser(requireAuthenticatedActor(req));
}

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

const MASTER_API_STATUSES = new Set<string>([
  TEMPLATE_STATUS.DRAFT,
  TEMPLATE_STATUS.PUBLISHED,
]);

function normalizeStatus(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  let canonical = raw.trim().replace(/\s+/g, '_').toUpperCase();
  if (canonical === 'PUBLISH') canonical = TEMPLATE_STATUS.PUBLISHED;
  if (MASTER_API_STATUSES.has(canonical)) return canonical;
  return undefined;
}

function normalizeStatusOrThrow(raw: unknown, fieldName: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const normalized = normalizeStatus(raw);
  if (!normalized) {
    throwVal(`Invalid ${fieldName}. Allowed values: DRAFT, PUBLISHED (or PUBLISH)`, 400, 'VALIDATION_ERROR');
  }
  return normalized;
}

/** Match create flow: templateCode → templateId (uppercase, underscores → hyphens). */
function normalizePathTemplateId(templateId: string): string {
  return TemplateEntityBuilder.normalizeTemplateId(templateId);
}

function normalizeTemplateType(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return TemplateEntityBuilder.normalizeTemplateType(raw);
}

/**
 * Derive a stable templateCode from a human name when the client does not send one.
 * "Task Monitoring Master" -> "TASK-MONITORING-MASTER" (becomes the templateId path param).
 */
function deriveTemplateCodeFromName(name: string | undefined): string | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}

/** Canonical profile fields live only in fieldValues (not duplicated on the VERSION document root). */
function mergeProfileFieldsIntoFieldValues(
  body: Record<string, unknown>,
  templateProfile: Record<string, unknown>,
): Record<string, unknown> {
  const fv = { ...asRecord(body.fieldValues) };
  const pick = (key: string, ...sources: unknown[]): void => {
    for (const raw of sources) {
      const v = firstString(raw);
      if (v) {
        fv[key] = v;
        return;
      }
    }
  };
  pick(
    'categoryCode',
    body.categoryCode,
    body.category,
    fv.categoryCode,
    templateProfile.category,
  );
  pick(
    'conditionCode',
    body.conditionCode,
    body.condition,
    fv.conditionCode,
    templateProfile.condition,
  );
  pick('shareScope', body.shareScope, fv.shareScope);
  return fv;
}

function stripRootProfileFields(body: Record<string, unknown>): void {
  delete body.category;
  delete body.condition;
  delete body.shareScope;
  delete body.categoryCode;
  delete body.conditionCode;
}

function normalizeCreateMasterBody(rawBody: unknown): CreateMasterTemplateBody & {
  templateCode: string;
  templateName: string;
} {
  const body = asRecord(rawBody);
  const templateMetadata = asRecord(body.templateMetadata);
  const templateProfile = asRecord(body.templateProfile);

  const fieldValues = asRecord(body.fieldValues);
  const templateName =
    firstString(body.templateName) ??
    firstString(body.TEMPLATE_NAME) ??
    firstString(templateMetadata.templateName) ??
    firstString(fieldValues.TEMPLATE_NAME) ??
    firstString(fieldValues.templateName) ??
    firstString(fieldValues.TASK_NAME);
  // templateCode is optional in the payload: derive it from the name so the client
  // can create with just a name (templateId is built from this code).
  const templateCode =
    firstString(body.templateCode) ??
    firstString(fieldValues.templateCode) ??
    deriveTemplateCodeFromName(templateName);
  const templateType = normalizeTemplateType(body.templateType ?? fieldValues.templateType);
  const status =
    normalizeStatus(body.status) ??
    normalizeStatus(fieldValues.status) ??
    normalizeStatus(templateMetadata.status);

  const versionRaw = body.version ?? templateMetadata.version;
  const version =
    typeof versionRaw === 'number' && Number.isFinite(versionRaw) && versionRaw > 0
      ? Math.trunc(versionRaw)
      : undefined;

  const createdBy =
    firstString(body.createdBy) ??
    firstString(templateMetadata.createdBy) ??
    firstString(templateMetadata.lastModifiedBy);

  const mergedFieldValues = mergeProfileFieldsIntoFieldValues(body, templateProfile);
  const shareScopeRaw =
    mergedFieldValues.shareScope ?? body.shareScope ?? templateMetadata.shareScope;
  if (
    shareScopeRaw !== undefined &&
    shareScopeRaw !== null &&
    shareScopeRaw !== '' &&
    typeof shareScopeRaw === 'string'
  ) {
    mergedFieldValues.shareScope = normalizeShareScopeOrThrow(shareScopeRaw);
  }

  const normalized: CreateMasterTemplateBody & { templateCode: string; templateName: string } = {
    ...body,
    fieldValues: mergedFieldValues,
    templateCode: templateCode ?? '',
    templateName: templateName ?? '',
    ...(templateType ? { templateType } : {}),
    ...(status ? { status } : {}),
    ...(version ? { version } : {}),
    conditions: asStringArray(body.conditions ?? mergedFieldValues.conditionCodes),
    countries: asStringArray(
      body.countries ?? body.countryCodes ?? mergedFieldValues.countryCodes ?? templateProfile.country,
    ),
    languages: asStringArray(
      body.languages ?? body.languageCodes ?? mergedFieldValues.languageCodes ?? templateProfile.language,
    ),
    specialty: asStringArray(body.specialty ?? mergedFieldValues.specialty ?? templateProfile.specialty),
    specialties: asStringArray(body.specialties),
  };
  stripRootProfileFields(normalized);

  if (!normalized.templateName) {
    throwVal(
      'templateName is required (templateName, TEMPLATE_NAME, templateMetadata.templateName, or fieldValues.TEMPLATE_NAME / TASK_NAME)',
      400,
      'VALIDATION_ERROR',
    );
  }
  if (!normalized.templateCode) {
    throwVal(
      'templateCode could not be derived; provide templateCode or a valid templateName',
      400,
      'VALIDATION_ERROR',
    );
  }

  return normalized;
}

/** Partial master save (PUT /templates/{templateId}) — no required templateCode/name. */
function normalizeMasterSaveBody(rawBody: unknown): Record<string, unknown> {
  const body = asRecord(rawBody);
  const templateMetadata = asRecord(body.templateMetadata);
  const templateProfile = asRecord(body.templateProfile);
  const fieldValues = asRecord(body.fieldValues);

  const templateName =
    firstString(body.templateName) ??
    firstString(body.TEMPLATE_NAME) ??
    firstString(templateMetadata.templateName) ??
    firstString(fieldValues.TEMPLATE_NAME) ??
    firstString(fieldValues.templateName) ??
    firstString(fieldValues.TASK_NAME);

  const templateType = normalizeTemplateType(body.templateType ?? fieldValues.templateType);
  const status =
    normalizeStatus(body.status) ??
    normalizeStatus(fieldValues.status) ??
    normalizeStatus(templateMetadata.status);

  const mergedFieldValues = mergeProfileFieldsIntoFieldValues(body, templateProfile);
  const shareScopeRaw =
    mergedFieldValues.shareScope ?? body.shareScope ?? templateMetadata.shareScope;
  if (
    shareScopeRaw !== undefined &&
    shareScopeRaw !== null &&
    shareScopeRaw !== '' &&
    typeof shareScopeRaw === 'string'
  ) {
    mergedFieldValues.shareScope = normalizeShareScopeOrThrow(shareScopeRaw);
  }

  const normalized: Record<string, unknown> = { ...body, fieldValues: mergedFieldValues };
  if (templateName) normalized.templateName = templateName;
  if (templateType) normalized.templateType = templateType;
  if (status) normalized.status = status;
  stripRootProfileFields(normalized);

  const countries = asStringArray(
    body.countries ?? body.countryCodes ?? mergedFieldValues.countryCodes ?? templateProfile.country,
  );
  if (countries) normalized.countries = countries;
  const languages = asStringArray(
    body.languages ?? body.languageCodes ?? mergedFieldValues.languageCodes ?? templateProfile.language,
  );
  if (languages) normalized.languages = languages;

  return normalized;
}

export type ValidatedListMaster = {
  query: ListMasterTemplatesQuery;
  actorUser: TemplateActorUser;
};

export type ValidatedGetMasterVersions = {
  templateId: string;
  query: GetMasterVersionsQuery;
  actorUser: TemplateActorUser;
};

export type ValidatedTemplateVersionPath = {
  templateId: string;
  versionId: string;
  actorUser: TemplateActorUser;
};

export type ValidatedUpdateMasterVersion = ValidatedTemplateVersionPath & {
  body: UpdateMasterTemplateBody;
};

export type ValidatedSaveMaster = {
  templateId: string;
  templateVersionId?: string;
  body: Record<string, unknown>;
  actorUser: TemplateActorUser;
};

export type ValidatedStatusTransition = ValidatedTemplateVersionPath & {
  body: StatusTransitionBody;
  /** Set when caller is org-scoped (JWT org or explicit query). Used to route org vs master transition. */
  organizationId?: string;
};

async function validateActorAndVersionPath(
  req: LambdaRequest,
): Promise<ValidatedTemplateVersionPath> {
  const actorUser = await requireActorUser(req);

  const path = templateVersionPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('templateId and versionId are required', 400, 'VALIDATION_ERROR');
  }

  return {
    templateId: normalizePathTemplateId(path.data.templateId),
    versionId: path.data.versionId,
    actorUser,
  };
}

function hasUpsertPathTemplateId(req: LambdaRequest): boolean {
  const raw = req.pathParameters?.templateId;
  return typeof raw === 'string' && raw.trim().length > 0;
}

export async function validateUpsertMasterTemplateRequest(req: LambdaRequest): Promise<void> {
  if (hasUpsertPathTemplateId(req)) {
    await validateSaveMasterTemplateRequest(req);
  } else {
    await validateCreateMasterRequest(req);
  }
}

export async function validateCreateMasterRequest(req: LambdaRequest): Promise<void> {
  (req as LambdaRequest & { validatedCreateMaster?: ValidatedCreateMaster }).validatedCreateMaster = {
    actorUser: await requireActorUser(req),
    body: normalizeCreateMasterBody(req.body),
  };
}

export async function validateListMasterRequest(req: LambdaRequest): Promise<void> {
  const actorUser = requireAuthenticatedActor(req);

  const rawQuery = parseListMasterTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );
  const query: ListMasterTemplatesQuery = {
    ...rawQuery,
    status: normalizeStatusOrThrow(rawQuery.status, 'status'),
    templateType: normalizeTemplateType(rawQuery.templateType) ?? rawQuery.templateType,
  };

  (req as LambdaRequest & { validatedListMaster?: ValidatedListMaster }).validatedListMaster = {
    query,
    actorUser,
  };
}

export async function validateGetMasterVersionsRequest(req: LambdaRequest): Promise<void> {
  const actorUser = requireAuthenticatedActor(req);

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
      actorUser,
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

export async function validateSaveMasterTemplateRequest(req: LambdaRequest): Promise<void> {
  const actorUser = await requireActorUser(req);

  const path = templateIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('templateId is required', 400, 'VALIDATION_ERROR');
  }

  const rawBody = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const body = normalizeMasterSaveBody(rawBody);

  const resolved = TemplateEntityBuilder.resolveMasterPathParam(path.data.templateId);

  (req as LambdaRequest & { validatedSaveMaster?: ValidatedSaveMaster }).validatedSaveMaster = {
    templateId: resolved.templateId,
    templateVersionId: resolved.templateVersionId,
    body,
    actorUser,
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

  if (!organizationId) {
    throwVal(
      'organizationId is required for org status transitions. For master templates use PUT /templates/{templateId} with lifecycleAction.',
      400,
      'VALIDATION_ERROR',
    );
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
  actorUser: TemplateActorUser;
  body?: CloneTemplateBody;
};

export type ValidatedGetOrgVersions = {
  organizationId: string;
  templateId: string;
  query: GetMasterVersionsQuery;
  actorUser: TemplateActorUser;
};

export type ValidatedListOrg = {
  organizationId: string;
  query: ListOrgTemplatesQuery;
  actorUser: TemplateActorUser;
};

export async function validateCloneOrgTemplateRequest(req: LambdaRequest): Promise<void> {
  const actorUser = await requireActorUser(req);

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
      actorUser,
      body,
    };
}

function resolveOrgTemplateIds(req: LambdaRequest): { organizationId: string; templateId: string } {
  const pathParams = req.pathParameters ?? {};
  const pathOrg = firstString(pathParams.organizationId);
  const pathTemplateId = firstString(pathParams.templateId);
  const qs = req.event.queryStringParameters as Record<string, string | undefined> | null;
  const queryOrg = firstString(qs?.organizationId);

  const organizationId = resolveOrganizationId(req, pathOrg ?? queryOrg);
  const templateIdRaw = pathTemplateId;
  if (!templateIdRaw) {
    throwVal('templateId is required', 400, 'VALIDATION_ERROR');
  }
  return {
    organizationId,
    templateId: normalizePathTemplateId(templateIdRaw),
  };
}

export async function validateGetOrgVersionsRequest(req: LambdaRequest): Promise<void> {
  const actorUser = requireAuthenticatedActor(req);

  const { organizationId, templateId } = resolveOrgTemplateIds(req);
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
      templateId,
      query,
      actorUser,
    };
}

export async function validateDeriveTemplateRequest(req: LambdaRequest): Promise<void> {
  const actorUser = await requireActorUser(req);

  const body = deriveTemplateBodySchema.parse(req.body ?? {});
  const organizationId = resolveOrganizationId(req, body.organizationMeta.id);

  let resolved: { templateId: string; templateVersionId: string };
  try {
    resolved = await getTemplateService().resolvePublishedMasterForDerive({
      templateIdOrName: body.templateId,
      templateType: body.templateType,
      categoryCode: body.categoryCode,
      conditionCode: body.conditionCode,
    });
  } catch (e: unknown) {
    normalizeTemplateServiceError(e);
  }

  (req as LambdaRequest & { validatedCloneOrgTemplate?: ValidatedCloneOrgTemplate }).validatedCloneOrgTemplate =
    {
      organizationId,
      templateId: resolved.templateId,
      versionId: '',
      actorUser,
      body: {
        organizationMeta: body.organizationMeta,
        templateId: resolved.templateId,
        categoryCode: body.categoryCode,
        conditionCode: body.conditionCode,
        templateType: body.templateType,
      },
    };
}

export async function validateListOrgTemplatesRequest(req: LambdaRequest): Promise<void> {
  const actorUser = requireAuthenticatedActor(req);

  const rawQuery = parseListOrgTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );
  const query: ListOrgTemplatesQuery = {
    ...rawQuery,
    status: rawQuery.status ? normalizeStatusOrThrow(rawQuery.status, 'status') : undefined,
  };
  const organizationId = resolveOrganizationId(
    req,
    query.organizationId ?? query.organizationMetaId,
  );

  (req as LambdaRequest & { validatedListOrg?: ValidatedListOrg }).validatedListOrg = {
    organizationId,
    query,
    actorUser,
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
  actorUser: TemplateActorUser;
};

export async function validateUpdateOrgTemplateVersionRequest(req: LambdaRequest): Promise<void> {
  const actorUser = await requireActorUser(req);

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
      actorUser,
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
  const actorUser = requireAuthenticatedActor(req);

  const query = parseListCompatibleTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );

  (req as LambdaRequest & { validatedListCompatible?: ValidatedListCompatible }).validatedListCompatible =
    {
      query,
      actorUser,
    };
}

