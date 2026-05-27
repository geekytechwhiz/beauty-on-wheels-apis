import { LambdaRequest } from '@api-hub/utils';

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
  type CloneTemplateBody,
  type CreateMasterTemplateBody,
  type CreateOrgEnablementBody,
  parseListCompatibleTemplatesQuery,
  type ListCompatibleTemplatesQuery,
  type UpdateOrgTemplateBody,
  updateOrgTemplateBodySchema,
  type GetMasterVersionsQuery,
  type ListMasterTemplatesQuery,
  type ListOrgTemplatesQuery,
  type StatusTransitionBody,
  type UpdateMasterTemplateBody,
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
  body: CreateMasterTemplateBody;
};

export type ValidatedListMaster = {
  query: ListMasterTemplatesQuery;
  actorUserId: string;
};

export type ValidatedGetMasterMeta = {
  templateId: string;
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
    templateId: path.data.templateId,
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
    body: req.body as CreateMasterTemplateBody,
  };
}

export async function validateListMasterRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const query = parseListMasterTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );

  (req as LambdaRequest & { validatedListMaster?: ValidatedListMaster }).validatedListMaster = {
    query,
    actorUserId,
  };
}

export async function validateGetMasterMetaRequest(req: LambdaRequest): Promise<void> {
  const authHeader = req.context.authHeader;
  const actorUserId = getActorUserIdForRequest(req.event, authHeader);
  if (!actorUserId) {
    throwVal('User could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const path = templateIdPathSchema.safeParse(req.pathParameters ?? {});
  if (!path.success) {
    throwVal('templateId is required', 400, 'VALIDATION_ERROR');
  }

  (req as LambdaRequest & { validatedGetMasterMeta?: ValidatedGetMasterMeta }).validatedGetMasterMeta = {
    templateId: path.data.templateId,
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

  const query = parseGetMasterVersionsQuery(
    req.event.queryStringParameters as Record<string, string | string[] | undefined> | null,
  );

  (req as LambdaRequest & { validatedGetMasterVersions?: ValidatedGetMasterVersions }).validatedGetMasterVersions =
    {
      templateId: path.data.templateId,
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
  (req as LambdaRequest & { validatedStatusTransition?: ValidatedStatusTransition }).validatedStatusTransition = {
    ...base,
    body: req.body as StatusTransitionBody,
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
      templateId: path.data.templateId,
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
  const query = parseGetMasterVersionsQuery(
    req.event.queryStringParameters as Record<string, string | string[] | undefined> | null,
  );

  (req as LambdaRequest & { validatedGetOrgVersions?: ValidatedGetOrgVersions }).validatedGetOrgVersions =
    {
      organizationId,
      templateId: path.data.templateId,
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

  const query = parseListOrgTemplatesQuery(
    req.params as Record<string, string | string[] | undefined>,
  );
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
      templateId: path.data.templateId,
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

