/** Canonical enum values — camelCase for API JSON and DynamoDB attributes. */

export const RUNTIME_TASK_SOURCE = {
  CARE_PLAN_TASK_LINKAGE: 'carePlanTaskLinkage',
  MONITORING_RUNTIME: 'monitoringRuntime',
  SERVICE_FLOW_RUNTIME: 'serviceFlowRuntime',
  MANUAL_SYSTEM: 'manualSystem',
} as const;

export type RuntimeTaskSource = (typeof RUNTIME_TASK_SOURCE)[keyof typeof RUNTIME_TASK_SOURCE];

export type TaskBehaviorCode =
  | 'INSTRUCTION'
  | 'DOCUMENT_FORM'
  | 'UPLOAD_DOCUMENT'
  | 'DEVICE_SETUP'
  | 'EDUCATION_VIDEO'
  | 'EDUCATION_ARTICLE'
  | 'CARE_TEAM_TASK'
  | 'METRIC_CHECKIN'
  | 'SYMPTOM_CHECKIN';

export const TASK_DISPLAY_GROUP = {
  ACTION: 'action',
  LEARNING: 'learning',
  CHECK_IN: 'checkIn',
  STAFF_TASK: 'staffTask',
} as const;

export type TaskDisplayGroup = (typeof TASK_DISPLAY_GROUP)[keyof typeof TASK_DISPLAY_GROUP];

/**
 * Who completes or owns a runtime task — camelCase on API wire and DynamoDB.
 * Shared with TASK, ALERT, ROLES_PERMISSIONS domains.
 */
export const ASSIGNED_TO_TYPE = {
  PATIENT: 'patient',
  CARE_TEAM_ROLE: 'careTeamRole',
  USER: 'user',
  ORG_STAFF: 'orgStaff',
  SYSTEM: 'system',
} as const;

export type AssignedToType = (typeof ASSIGNED_TO_TYPE)[keyof typeof ASSIGNED_TO_TYPE];

/** Non-patient assignees are indexed on GSI1. orgStaff uses `ORG#<org>#STAFF#<id>`; others use `STAFF#<assignedToType>#<id>`. */
export const GSI_ASSIGNEE_ASSIGNED_TO_TYPES = [
  ASSIGNED_TO_TYPE.CARE_TEAM_ROLE,
  ASSIGNED_TO_TYPE.USER,
  ASSIGNED_TO_TYPE.ORG_STAFF,
  ASSIGNED_TO_TYPE.SYSTEM,
] as const satisfies readonly AssignedToType[];

export function isPatientAssignedToType(assignedToType: AssignedToType): boolean {
  return assignedToType === ASSIGNED_TO_TYPE.PATIENT;
}

export function requiresAssigneeGsi(assignedToType: AssignedToType): boolean {
  return !isPatientAssignedToType(assignedToType);
}

/** Legacy wire value `staff` → `orgStaff` when reading older rows. */
export function normalizeAssignedToTypeForWire(value: string): AssignedToType {
  if (value === 'staff') {
    return ASSIGNED_TO_TYPE.ORG_STAFF;
  }
  return value as AssignedToType;
}

export const SURFACE_SECTION = {
  TODAY: 'today',
  UPCOMING: 'upcoming',
  NEEDS_ATTENTION: 'needsAttention',
  HISTORY: 'history',
  CARE_PLAN_CHECKLIST: 'carePlanChecklist',
} as const;

export type SurfaceSection = (typeof SURFACE_SECTION)[keyof typeof SURFACE_SECTION];

export const TASK_HISTORY_EVENT_TYPE = {
  STATE_CHANGE: 'stateChange',
  ASSIGNED_TO_STAFF_CHANGE: 'assignedToStaffChange',
  REMINDER_SETTINGS_CHANGE: 'reminderSettingsChange',
  REMINDER_REGISTER_REQUEST: 'reminderRegisterRequest',
  REMINDER_CANCEL_REQUEST: 'reminderCancelRequest',
  TASK_METADATA_CHANGE: 'taskMetadataChange',
} as const;

export type TaskHistoryEventType =
  (typeof TASK_HISTORY_EVENT_TYPE)[keyof typeof TASK_HISTORY_EVENT_TYPE];

export const IDEMPOTENCY_OUTCOME = {
  CREATED: 'created',
  SKIPPED_DUPLICATE: 'skippedDuplicate',
} as const;

export type IdempotencyOutcome = (typeof IDEMPOTENCY_OUTCOME)[keyof typeof IDEMPOTENCY_OUTCOME];

export const TRANSITION_SOURCE = {
  MANUAL: 'manual',
  SCHEDULER: 'scheduler',
  SOURCE_EVENT: 'sourceEvent',
  SYSTEM: 'system',
} as const;

export type TransitionSource = (typeof TRANSITION_SOURCE)[keyof typeof TRANSITION_SOURCE];

export const WORKFLOW_STAGE = {
  ONBOARDING: 'onboarding',
  ONGOING: 'ongoing',
  REVIEW: 'review',
  CLOSURE: 'closure',
} as const;

export type WorkflowStage = (typeof WORKFLOW_STAGE)[keyof typeof WORKFLOW_STAGE];

export interface ReminderSettings {
  channels?: string[];
  quietHoursRespected?: boolean;
  [key: string]: unknown;
}

/** Client action verbs for POST /tasks/{id}/state — camelCase wire values. */
export const TASK_RUNTIME_ACTION = {
  COMPLETE: 'complete',
  DISMISS: 'dismiss',
  CANCEL: 'cancel',
  MARK_MISSED: 'markMissed',
} as const;

export type TaskRuntimeAction = (typeof TASK_RUNTIME_ACTION)[keyof typeof TASK_RUNTIME_ACTION];

/** Who performed a state update or portal mutation. */
export const ACTOR_TYPE = {
  PATIENT: 'patient',
  STAFF: 'staff',
} as const;

export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];

export const COMPLETION_SOURCE = {
  MANUAL: 'manual',
  LINKED_OBJECT: 'linkedObject',
  SYSTEM: 'system',
} as const;

export type CompletionSource = (typeof COMPLETION_SOURCE)[keyof typeof COMPLETION_SOURCE];

export const REMINDER_STATUS = {
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
} as const;

export type ReminderStatus = (typeof REMINDER_STATUS)[keyof typeof REMINDER_STATUS];

/** Reminder delivery channels — camelCase wire + persistence. */
export const REMINDER_CHANNEL = {
  PUSH: 'push',
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'inApp',
} as const;

export type ReminderChannel = (typeof REMINDER_CHANNEL)[keyof typeof REMINDER_CHANNEL];

/** Care-plan stage readiness rollup (GET .../task-status-summary). */
export const READINESS_STATUS = {
  READY: 'ready',
  NOT_READY: 'notReady',
  NOT_APPLICABLE: 'notApplicable',
} as const;

export type ReadinessStatus = (typeof READINESS_STATUS)[keyof typeof READINESS_STATUS];
