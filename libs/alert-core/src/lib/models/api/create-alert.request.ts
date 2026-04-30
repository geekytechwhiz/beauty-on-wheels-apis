import { PriorityBand } from '../types/priority-band.type';

export interface CreateAlertRequest {
  organizationId: string;
  actorUserId?: string;

  inputEventId?: string;
  inputType: string;
  sourceType: string;

  patientId: string;
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
}
