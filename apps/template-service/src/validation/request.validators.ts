/**
 * Validators for {@link withLambdaHandler}. Each receives the full request and throws
 * an error with `statusCode` / `code` when validation fails (see user-service pattern).
 */

import {
  createTemplateBodySchema,
  executeTemplateBodySchema,
  updateTemplateBodySchema,
} from '@api-hub/template-core';
import type { ZodIssue } from 'zod';
import { resolveOrganizationIdFromRequest } from '../utils/orgContext';

export function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
  details?: Array<{ field?: string; message: string }>,
): never {
  const err: Error & { statusCode?: number; code?: string; details?: typeof details } = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

function issueDetails(issues: ZodIssue[]) {
  return issues.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

function requireOrganization(req: any) {
  const organizationId = resolveOrganizationIdFromRequest(req);
  if (!organizationId) {
    throwVal('Unauthorized', 401, 'UNAUTHORIZED');
  }
  req.validatedOrganizationId = organizationId;
}

export function validateCreateTemplate(req: any) {
  requireOrganization(req);
  const body = req.body ?? {};
  const result = createTemplateBodySchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }
  req.validatedCreateTemplate = result.data;
}

export function validateGetTemplate(req: any) {
  requireOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throwVal('template id is required', 400, 'COMMON.BAD_REQUEST');
  }
  const scope = req.params?.scope === 'master' ? 'master' : 'org';
  req.validatedGetTemplate = {
    templateId: String(templateId),
    version: req.params?.version ?? undefined,
    scope,
  };
}

export function validateUpdateTemplate(req: any) {
  requireOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throwVal('template id is required', 400, 'COMMON.BAD_REQUEST');
  }
  const body = req.body ?? {};
  const result = updateTemplateBodySchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }
  const scope = req.params?.scope === 'master' ? 'master' : 'org';
  req.validatedUpdateTemplate = { templateId: String(templateId), payload: result.data, scope };
}

export function validateExecuteTemplate(req: any) {
  requireOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throwVal('template id is required', 400, 'COMMON.BAD_REQUEST');
  }
  const body = req.body ?? {};
  const result = executeTemplateBodySchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }
  req.validatedExecuteTemplate = { templateId: String(templateId), payload: result.data };
}
