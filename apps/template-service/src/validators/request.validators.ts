import { LambdaRequest } from '@api-hub/utils';

import { getActorUserIdForRequest } from '../utils/helpers';
import {
  parseGetMasterVersionsQuery,
  parseListMasterTemplatesQuery,
  templateIdPathSchema,
  type CreateMasterTemplateBody,
  type GetMasterVersionsQuery,
  type ListMasterTemplatesQuery,
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
