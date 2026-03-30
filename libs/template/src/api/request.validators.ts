import type { ZodIssue } from 'zod';
import { TemplateUnauthorizedError, TemplateValidationError } from '../shared';
import {
  resolveOrganizationIdFromRequest,
  resolveTemplateOrganizationId,
  resolveTemplateScope,
  type TemplateScope,
} from '../policies';
import { createTemplateBodySchema, executeTemplateBodySchema, updateTemplateBodySchema } from './request.schemas';

function issueDetails(issues: ZodIssue[]) {
  return issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

function requireRequestOrganizationId(req: any): string {
  const organizationId = resolveOrganizationIdFromRequest(req);
  if (!organizationId) {
    throw new TemplateUnauthorizedError();
  }
  req.validatedOrganizationId = organizationId;
  return organizationId;
}

function resolveScopedOrganization(req: any): { requestOrgId: string; orgId: string; scope: TemplateScope } {
  const requestOrgId = requireRequestOrganizationId(req);
  const scope = resolveTemplateScope(req.params?.scope);
  const orgId = resolveTemplateOrganizationId(requestOrgId, scope);
  return { requestOrgId, orgId, scope };
}

export function validateCreateTemplate(req: any) {
  const requestOrgId = requireRequestOrganizationId(req);
  const result = createTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }
  req.validatedCreateTemplate = { orgId: requestOrgId, body: result.data };
}

export function validateGetTemplate(req: any) {
  const { orgId, scope } = resolveScopedOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }
  req.validatedGetTemplate = {
    orgId,
    scope,
    templateId: String(templateId),
    version: req.params?.version ?? undefined,
  };
}

export function validateUpdateTemplate(req: any) {
  const { orgId, scope } = resolveScopedOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }

  const result = updateTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }

  req.validatedUpdateTemplate = {
    orgId,
    scope,
    templateId: String(templateId),
    body: result.data,
  };
}

export function validateExecuteTemplate(req: any) {
  const requestOrgId = requireRequestOrganizationId(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }

  const result = executeTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }

  req.validatedExecuteTemplate = {
    orgId: requestOrgId,
    templateId: String(templateId),
    body: result.data,
  };
}
