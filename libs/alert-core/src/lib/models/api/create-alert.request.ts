export interface CreateAlertRequest {
  organizationId: string;
  actorUserId?: string;

  inputEventId: string;
  inputType: string;
  sourceType: string;

  patientId: string;
  /** Client-supplied patient display name (e.g. chart name at create time). */
  patientName: string;
  /** Client-supplied display name for the user calling the API (actor). */
  actorName?: string;
  /** Unix epoch milliseconds (UTC) — when the clinical/business condition occurred. */
  triggerTimestamp: number;

  evidencePayload: Record<string, unknown>;

  /** Product-defined priority label (e.g. P0–P3 or org-specific codes). */
  priority: string;
  groupingKey: string;

  appliesToType?: string;
  linkedEntityCode?: string;
  severityHint?: string;

  carePlanInstanceId?: string;
  packageAssignmentId?: string;

  alertPolicyTemplateVersionId: string;
  thresholdTemplateVersionId: string;

  triggerSummary?: string;
  triggerSummaryTemplateCode?: string;
  triggerSummaryParams?: Record<string, unknown>;

  /** Minutes from alert creation to first assignment. `0` means no assign SLA tracked. */
  assignSlaMinutes: number;
  /**
   * Minutes from first assignment to closure (RESOLVED / DISMISSED). `0` means no resolve SLA
   * tracked. `resolveSlaDueAt` is computed at first assignment.
   */
  resolveSlaMinutes: number;
}
