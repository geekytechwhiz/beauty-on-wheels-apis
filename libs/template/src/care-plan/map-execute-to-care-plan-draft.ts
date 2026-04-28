import type { TemplateExecutionResult } from '../domain/template.types';
import type { CarePlanDraft, CreateCarePlanDraftInput } from './care-plan-draft.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractLinkRequirements(actions: unknown): Array<{ requiredTemplate: string }> {
  if (!Array.isArray(actions)) {
    return [];
  }
  const out: Array<{ requiredTemplate: string }> = [];
  for (const raw of actions) {
    if (!isRecord(raw)) continue;
    const type = raw.type;
    const target = raw.target;
    if (type !== 'TRIGGER_EVENT' || target !== 'LINK_REQUIRED') continue;
    const value = raw.value;
    if (!isRecord(value)) continue;
    const required = value.requiredTemplate;
    if (typeof required === 'string' && required.trim() !== '') {
      out.push({ requiredTemplate: required });
    }
  }
  return out;
}

function extractValidationHints(actions: unknown): Record<string, unknown> {
  if (!Array.isArray(actions)) {
    return {};
  }
  const hints: Record<string, unknown> = {};
  for (const raw of actions) {
    if (!isRecord(raw)) continue;
    const type = raw.type;
    const target = raw.target;
    if (type !== 'SET' || typeof target !== 'string') continue;
    if (target.startsWith('validation.')) {
      hints[target] = raw.value;
    }
  }
  return hints;
}

function deriveStatus(linkRequirements: Array<{ requiredTemplate: string }>): CarePlanDraft['carePlanStatus'] {
  return linkRequirements.length > 0 ? 'ready_for_linking' : 'draft';
}

/**
 * Maps template execute output + patient binding into a {@link CarePlanDraft}.
 */
export function mapExecuteResultToCarePlanDraft(
  exec: TemplateExecutionResult,
  input: Pick<CreateCarePlanDraftInput, 'patientId' | 'effectiveDate'>,
): CarePlanDraft {
  const actions = exec.ruleEvaluation.actions as unknown;
  const linkRequirements = extractLinkRequirements(actions);
  const validationHints = extractValidationHints(actions);

  return {
    patientId: input.patientId,
    effectiveDate: input.effectiveDate,
    templateId: exec.resolved.templateId,
    templateVersion: exec.resolved.version,
    orgId: exec.resolved.orgId,
    resolutionChain: exec.resolved.resolutionChain,
    definition: { ...exec.resolved.config },
    policy: {
      matched: exec.ruleEvaluation.matched,
      appliedRuleIds: [...exec.ruleEvaluation.appliedRuleIds],
      linkRequirements,
      validationHints,
    },
    linkedResources: {},
    carePlanStatus: deriveStatus(linkRequirements),
    execution: {
      matched: exec.matched,
      actions: exec.actions,
      ruleEvaluation: exec.ruleEvaluation,
    },
  };
}
