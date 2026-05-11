import { PriorityBand } from '../types/priority-band.type';

export interface CreateAlertRequest {
  organizationId: string;
  actorUserId?: string;

  inputEventId?: string;
  inputType: string;
  sourceType: string;

  patientId: string;
  /** Client-supplied patient display name (e.g. chart name at create time). */
  patientName?: string;
  /** Client-supplied display name for the user calling the API (actor). */
  actorName?: string;
  triggerTimestamp: string;

  evidencePayload: Record<string, unknown>;

  priority?: PriorityBand;
  groupingKey?: string;

  appliesToType?: string;
  linkedEntityCode?: string;
  severityHint?: string;

  carePlanInstanceId?: string;
  packageAssignmentId?: string;

  alertPolicyTemplateVersionId?: string;
  thresholdTemplateVersionId?: string;

  triggerSummary?: string;
  triggerSummaryTemplateCode?: string;
  triggerSummaryParams?: Record<string, unknown>;

  /**
   * Minutes allowed from alert creation to first assignment. When omitted, falls back to
   * `ENV_ASSIGN_SLA_MINUTES` then `DEFAULT_ASSIGN_SLA_MINUTES`. `0` means "no SLA tracked".
   */
  assignSlaMinutes?: number;
  /**
   * Minutes allowed from first assignment to closure (RESOLVED / DISMISSED). When omitted,
   * falls back to `ENV_RESOLVE_SLA_MINUTES` then `DEFAULT_RESOLVE_SLA_MINUTES`. `0` means
   * "no SLA tracked". Stored on create; `resolveSlaDueAt` is computed at first assignment.
   */
  resolveSlaMinutes?: number;
}
