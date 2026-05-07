import type { TemplateExecutionResult } from '../domain/template.types';

/**
 * Input to create a draft from template execute (patient binding + template selection).
 */
export interface CreateCarePlanDraftInput {
  orgId: string;
  templateId: string;
  patientId: string;
  /** ISO 8601 date (date or date-time). */
  effectiveDate: string;
  version?: string;
  /** Merged into execute context (rule facts). patientId / effectiveDate are also added. */
  context?: Record<string, unknown>;
}

export type CarePlanDraftStatus = 'draft' | 'ready_for_linking' | 'active';

/**
 * Persistable draft: template definition + policy signals + patient binding.
 * Not a clinical CarePlan instance until stored by the owning service.
 */
export interface CarePlanDraft {
  patientId: string;
  effectiveDate: string;
  templateId: string;
  templateVersion: string;
  orgId: string;
  resolutionChain: Array<{ templateId: string; version: string }>;
  definition: Record<string, unknown>;
  policy: {
    matched: boolean;
    appliedRuleIds: string[];
    linkRequirements: Array<{ requiredTemplate: string }>;
    validationHints: Record<string, unknown>;
  };
  linkedResources: {
    okrPlanId?: string;
    taskTemplateRefs?: string[];
  };
  carePlanStatus: CarePlanDraftStatus;
  /** Raw execute result for debugging or advanced clients (optional). */
  execution?: Pick<TemplateExecutionResult, 'matched' | 'actions' | 'ruleEvaluation'>;
}
