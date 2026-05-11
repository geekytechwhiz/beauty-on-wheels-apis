import type { ZodIssue } from 'zod';
import { resolveOrganizationIdFromRequest } from '../../policies/org-context.policy';
import { TemplateUnauthorizedError, TemplateValidationError } from '../../shared/template.errors';
import { createCarePlanDraftBodySchema } from './create-care-plan-draft.schemas';

function issueDetails(issues: ZodIssue[]) {
  return issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

export function validateCreateCarePlanDraft(req: any) {
  const organizationId = resolveOrganizationIdFromRequest(req);
  if (!organizationId) {
    throw new TemplateUnauthorizedError();
  }

  const result = createCarePlanDraftBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }

  req.validatedCreateCarePlanDraft = {
    orgId: organizationId,
    ...result.data,
  };
}
