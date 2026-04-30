import { BaseEntity } from '../base/base.entity';
import { AlertState } from '../types/alert-state.type';
import { PriorityBand } from '../types/priority-band.type';

export interface Alert extends BaseEntity {
  alertId: string;
  patientId: string;
  /** Display name for `patientId`, supplied by the client on create (e.g. care UI). */
  patientName?: string;
  /** Display name of the authenticated user who created the alert; supplied by the client (not from JWT). */
  actorName?: string;

  inputEventId: string;
  inputType: string;
  sourceType: string;

  triggerTimestamp: string;

  triggerSummary: string;
  triggerSummaryTemplateCode?: string;
  triggerSummaryParams?: Record<string, unknown>;

  evidencePayload: Record<string, unknown>;

  priority: PriorityBand;
  alertState: AlertState;

  groupingKey: string;

  appliesToType?: string;
  linkedEntityCode?: string;
  severityHint?: string;

  carePlanInstanceId?: string;
  packageAssignmentId?: string;

  alertPolicyTemplateVersionId?: string;
  thresholdTemplateVersionId?: string;
}
