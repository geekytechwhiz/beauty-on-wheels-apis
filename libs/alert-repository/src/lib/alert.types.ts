/** Aligns with Alert-Service.yaml AlertState. */
export type AlertState =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'RESOLVED'
  | 'DISMISSED';

export type PriorityBand = 'P0' | 'P1' | 'P2' | 'P3';

export interface AlertRecord {
  pk: string;
  sk: string;
  entityType?: 'ALERT';
  alertId: string;
  patientId: string;
  organizationId: string;
  inputEventId: string;
  inputType: string;
  sourceType: string;
  alertState: AlertState;
  priority: PriorityBand;
  triggerTimestamp: string;
  triggerSummary: string;
  evidencePayload: Record<string, unknown>;
  slaBreachIndicator: boolean;
  groupingKey: string;
  /** GSI-1 Team queue: ORG#<orgId>#STATE#<alertState> / TS#<triggerTimestamp> */
  gsi1pk: string;
  gsi1sk: string;
  /** GSI-2 My queue (user) — only when assigned */
  gsi2pk?: string;
  gsi2sk?: string;
  /** GSI-3 Patient: PAT#… / TS#… */
  gsi3pk: string;
  gsi3sk: string;
  /** GSI-5 SLA: SLA#dateBucket / TS#due… */
  gsi5pk: string;
  gsi5sk: string;
  carePlanInstanceId?: string;
  packageAssignmentId?: string;
  appliesToType?: string;
  linkedEntityCode?: string;
  severityHint?: string;
  alertPolicyTemplateVersionId?: string;
  thresholdTemplateVersionId?: string;
  triggerSummaryTemplateCode?: string;
  triggerSummaryParams?: Record<string, unknown>;
  assignedToUserId?: string;
  assignSlaDueAt: string;
  resolveSlaDueAt?: string;
  assignSlaMinutes: number;
  resolveSlaMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertInput {
  organizationId: string;
  actorUserId?: string;
  inputEventId?: string;
  inputType: string;
  sourceType: string;
  patientId: string;
  carePlanInstanceId?: string;
  packageAssignmentId?: string;
  triggerTimestamp: string;
  appliesToType?: string;
  linkedEntityCode?: string;
  severityHint?: string;
  priority?: PriorityBand;
  alertPolicyTemplateVersionId?: string;
  thresholdTemplateVersionId?: string;
  groupingKey?: string;
  triggerSummary?: string;
  triggerSummaryTemplateCode?: string;
  triggerSummaryParams?: Record<string, unknown>;
  evidencePayload: Record<string, unknown>;
}

export interface UpdateAlertInput {
  alertState?: AlertState;
  assignedToUserId?: string | null;
  slaBreachIndicator?: boolean;
}

/** Single activity row under `ALERT#<id>` / `ACTIVITY#…` — API shape (no Dynamo keys). */
export interface AlertActivityRecord {
  activityId: string;
  alertId: string;
  activityType: string;
  activityTimestamp: string;
  performedBy: string;
  performedByDisplayName?: string;
  activityComment?: string;
  previousState?: AlertState;
  newState?: AlertState;
  previousPriority?: PriorityBand;
  newPriority?: PriorityBand;
  previousAssignee?: string;
  newAssignee?: string;
  evidencePayload?: Record<string, unknown>;
}
