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

export const ASSIGNED_TO_TYPE = {
  PATIENT: 'patient',
  CARE_TEAM: 'careTeam',
  PROVIDER: 'provider',
  SYSTEM: 'system',
} as const;

export type AssignedToType = (typeof ASSIGNED_TO_TYPE)[keyof typeof ASSIGNED_TO_TYPE];

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
  OWNER_CHANGE: 'ownerChange',
  REMINDER_SETTINGS_CHANGE: 'reminderSettingsChange',
  REMINDER_REGISTER_REQUEST: 'reminderRegisterRequest',
  REMINDER_CANCEL_REQUEST: 'reminderCancelRequest',
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

export const OWNER_TYPE = {
  USER: 'user',
  ROLE: 'role',
  TEAM: 'team',
} as const;

export type OwnerType = (typeof OWNER_TYPE)[keyof typeof OWNER_TYPE];

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
