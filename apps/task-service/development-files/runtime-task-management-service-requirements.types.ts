/**
 * Runtime Task Management Service — requirements-derived TypeScript contracts
 *
 * Source: `Runtime_Task_Management_Service_Requirements_v2.docx`
 * Extracted text: `Runtime_Task_Management_Service_Requirements_v2.extracted.txt`
 * Aligned with: `open-api.yaml`, `option-b-db-mapping.md`, `libs/task-core` wire format
 *
 * Scope:
 * - Domain + persistence-facing shapes (no implementations)
 * - HTTP APIs, inbound events, outbound commands
 * - Option B storage vs API read models (surfaceSection derived, not stored)
 *
 * Naming:
 * - Interface property names use camelCase (match API JSON and DynamoDB attributes).
 * - Enum string literals use camelCase except product codes (e.g. taskBehaviorCode values).
 * - TypeScript type names remain PascalCase.
 */

/** API + DynamoDB instants (Option B). */
export type EpochMillis = number;

/** Legacy / envelope-only; task payloads use EpochMillis. */
export type IsoDateString = string;
export type Id = string;

export type OrgId = Id;
export type PatientId = Id;
export type CarePlanInstanceId = Id;
export type RuntimeTaskInstanceId = Id;

/** @deprecated Use OrgId */
export type OrgID = OrgId;
/** @deprecated Use PatientId */
export type PatientID = PatientId;
/** @deprecated Use CarePlanInstanceId */
export type CarePlanInstanceID = CarePlanInstanceId;
/** @deprecated Use RuntimeTaskInstanceId */
export type RuntimeTaskInstanceID = RuntimeTaskInstanceId;
/** @deprecated Use Id */
export type ID = Id;

// =============================================================================
// Enums (wire / persistence values — camelCase except catalog codes)
// =============================================================================

export type RuntimeTaskSource =
  | 'carePlanTaskLinkage'
  | 'monitoringRuntime'
  | 'serviceFlowRuntime'
  | 'manualSystem';

/** Product / catalog code — SCREAMING_SNAKE per platform convention. */
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

export type TaskDisplayGroup = 'action' | 'learning' | 'checkIn' | 'staffTask';

export type AssignedToType = 'patient' | 'careTeam' | 'provider' | 'system';

export type WorkflowStage = 'onboarding' | 'ongoing' | 'review' | 'closure';

export type RuntimeTaskState =
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'missed'
  | 'dismissed'
  | 'cancelled';

/** Derived at read time — not stored on META. */
export type SurfaceSection =
  | 'today'
  | 'upcoming'
  | 'needsAttention'
  | 'history'
  | 'carePlanChecklist';

export type SurfaceSectionActionCenter = SurfaceSection | 'all';

export type TransitionSource = 'manual' | 'scheduler' | 'sourceEvent' | 'system';

export type TaskHistoryEventType =
  | 'stateChange'
  | 'assignedToStaffChange'
  | 'reminderSettingsChange'
  | 'reminderRegisterRequest'
  | 'reminderCancelRequest';

export type ReminderChannel = 'push' | 'sms' | 'email' | 'inApp';
export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled' | 'failed' | 'suppressed';

export type CompletionSource = 'manual' | 'linkedObject' | 'system';

export type CompletionSourceType =
  | 'manual'
  | 'document'
  | 'education'
  | 'deviceSetup'
  | 'monitoring'
  | 'symptom'
  | (string & {});

export type ActorType = 'patient' | 'careTeam' | 'provider' | 'system';

export type IdempotencyOutcome = 'created' | 'skippedDuplicate';

export type ReadinessStatus = 'ready' | 'notReady' | 'notApplicable';

// =============================================================================
// Reminder settings (META latest config — v2 REM-007)
// =============================================================================

export interface ReminderSettings {
  channels?: ReminderChannel[];
  quietHoursRespected?: boolean;
  [key: string]: unknown;
}

// =============================================================================
// Persisted models (Option B)
// =============================================================================

/**
 * META runtime task record — patient partition.
 * Does NOT store surfaceSection (derived in service from state + due window + context).
 */
export interface RuntimeTaskInstanceRecord {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  orgId: OrgId;
  patientId: PatientId;
  /** Denormalized at create; required on APIs that accept patientId. */
  patientDisplayName: string;
  carePlanInstanceId?: CarePlanInstanceId;
  runtimeTaskSource: RuntimeTaskSource;
  sourceTaskTemplateVersionId?: Id;
  carePlanTaskLinkageId?: Id;
  monitoringInstanceId?: Id;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  actionTargetId?: Id;
  completionSourceType?: CompletionSourceType;
  completionSourceReferenceId?: Id;
  displayTitle: string;
  description?: string;
  assignedToType: AssignedToType;
  /** When assignedToType is careTeam or provider; drives GSI1 staff inbox. */
  assignedToStaffId?: Id;
  /** Required with assignedToStaffId for careTeam/provider tasks and assign/reassign API. */
  assignedToStaffDisplayName?: string;
  displayToPatient: boolean;
  workflowStage?: WorkflowStage;
  taskGenerationTrigger?: string;
  requiredForStageCompletion?: boolean;
  displayAsChecklistItem?: boolean;
  dueWindowStart?: EpochMillis;
  dueWindowEnd?: EpochMillis;
  /**
   * @deprecated v2 — use dueWindowEnd. Not stored in Option B.
   */
  dueAt?: EpochMillis;
  currentState: RuntimeTaskState;
  primaryActionLabel?: string;
  deepLinkTarget?: string;
  reminderEnabled?: boolean;
  reminderSettings?: ReminderSettings;
  createdAt: EpochMillis;
  createdBy: string;
  lastUpdatedAt: EpochMillis;
  lastUpdatedBy: string;
}

/** LOOKUP row on TASK# partition. */
export interface TaskLookupRecord {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  orgId: OrgId;
  patientId: PatientId;
  patientDisplayName?: string;
  taskSk: string;
  dueWindowStart?: EpochMillis;
  dueWindowEnd?: EpochMillis;
  carePlanInstanceId?: CarePlanInstanceId;
  assignedToStaffId?: Id;
  assignedToStaffDisplayName?: string;
  reminderHistory?: ReminderRecord[];
  evidenceSummary?: TaskEvidenceSummary;
}

/** @deprecated Use RuntimeTaskInstanceRecord — persisted shape has no surfaceSection. */
export type RuntimeTaskInstance = RuntimeTaskInstanceRecord;

export interface TaskStateHistory {
  taskStateHistoryId: Id;
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  historyEventType: TaskHistoryEventType;
  fromState?: RuntimeTaskState;
  toState?: RuntimeTaskState;
  transitionAt: EpochMillis;
  transitionBy: string;
  transitionSource: TransitionSource;
  transitionReason?: string;
  sourceEventId?: Id;
  previousReminderEnabled?: boolean;
  newReminderEnabled?: boolean;
  previousReminderSettings?: ReminderSettings;
  newReminderSettings?: ReminderSettings;
  reminderRecordId?: Id;
  reminderChannel?: ReminderChannel;
  schedulerJobId?: Id;
  previousReminderStatus?: ReminderStatus;
  newReminderStatus?: ReminderStatus;
  previousAssignedToStaffId?: Id;
  newAssignedToStaffId?: Id;
  previousAssignedToStaffDisplayName?: string;
  newAssignedToStaffDisplayName?: string;
}

/** Operational reminder trail on LOOKUP (not HIST#). */
export interface ReminderRecord {
  reminderRecordId: Id;
  runtimeTaskInstanceId?: RuntimeTaskInstanceId;
  scheduledReminderAt: EpochMillis;
  reminderChannel: ReminderChannel;
  reminderStatus: ReminderStatus;
  sentAt?: EpochMillis;
  updatedAt?: EpochMillis;
  failureReason?: string;
  suppressedReason?: string;
  schedulerJobId?: Id;
}

export interface CompletionEvidence {
  completionEvidenceId: Id;
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  orgId?: OrgId;
  patientId?: PatientId;
  completionSource: CompletionSource;
  completionSourceType?: CompletionSourceType;
  completionSourceReferenceId?: Id;
  completionEventId?: Id;
  completedAt: EpochMillis;
  completedBy?: string;
  evidencePayload?: Record<string, unknown>;
}

/** LOOKUP evidenceSummary rollup — surfaceSection not stored. */
export interface TaskEvidenceSummary {
  taskEvidenceSummaryId: Id;
  generatedAt: EpochMillis;
  runtimeTaskSource?: RuntimeTaskSource;
  taskBehaviorCode?: TaskBehaviorCode;
  taskDisplayGroup?: TaskDisplayGroup;
  currentState?: RuntimeTaskState;
  patientId?: PatientId;
  carePlanInstanceId?: CarePlanInstanceId;
  requiredForStageCompletion?: boolean;
  workflowStage?: WorkflowStage;
  completedAt?: EpochMillis;
  missedAt?: EpochMillis;
  completionSourceType?: CompletionSourceType;
  completionSourceReferenceId?: Id;
  latestCompletionSummary?: string;
}

// =============================================================================
// API read models (derived + projected fields)
// =============================================================================

export interface RuntimeTaskCard extends RuntimeTaskInstanceRecord {
  surfaceSection: SurfaceSection;
  surfaceRank?: number;
  dueDisplayText?: string;
  contextDisplayText?: string;
  isSurfaceVisible?: boolean;
}

export interface RuntimeTaskDetail {
  task: RuntimeTaskCard;
  reminders?: ReminderRecord[];
  completionEvidence?: CompletionEvidence[];
  evidenceSummary?: TaskEvidenceSummary;
}

export interface PaginatedRuntimeTaskCards {
  items?: RuntimeTaskCard[];
  nextToken?: string;
}

export interface ActionCenterSingleSection {
  surfaceSection: SurfaceSection;
  items: RuntimeTaskCard[];
  nextToken?: string;
}

export interface ActionCenterGroupedSections {
  sections: Partial<Record<SurfaceSection, RuntimeTaskCard[]>>;
  nextToken?: string;
}

export type ActionCenterItems = ActionCenterSingleSection | ActionCenterGroupedSections;

export interface PaginatedTaskHistory {
  items?: TaskStateHistory[];
  nextToken?: string;
}

// =============================================================================
// HTTP APIs
// =============================================================================

export interface GenerateCarePlanTasksRequest {
  patientId: PatientId;
  patientDisplayName: string;
  carePlanInstanceId: CarePlanInstanceId;
  taskGenerationTrigger: string;
  sourceLinkageContext: {
    linkages: GenerateCarePlanTaskLinkage[];
  };
  workflowStage?: WorkflowStage;
  dryRun?: boolean;
}

export interface GenerateCarePlanTaskLinkage {
  carePlanTaskLinkageId: Id;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  displayTitle: string;
  assignedToType: AssignedToType;
  displayToPatient: boolean;
  assignedToStaffId?: Id;
  assignedToStaffDisplayName?: string;
  dueWindowStart: EpochMillis;
  dueWindowEnd: EpochMillis;
}

export interface GeneratedTaskResult {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  outcome: IdempotencyOutcome;
  task?: RuntimeTaskCard;
}

export interface GenerateCarePlanTasksResponse {
  results: GeneratedTaskResult[];
  createdCount?: number;
  skippedDuplicateCount?: number;
  failureDetails?: Array<{ message: string; code?: string; context?: Record<string, unknown> }>;
}

export interface CreateMonitoringActionRequest {
  patientId: PatientId;
  patientDisplayName: string;
  carePlanInstanceId: CarePlanInstanceId;
  monitoringInstanceId: Id;
  taskBehaviorCode: TaskBehaviorCode;
  dueWindowStart: EpochMillis;
  dueWindowEnd: EpochMillis;
  reminderContext?: Record<string, unknown>;
}

export interface CreateMonitoringActionResponse {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  outcome?: IdempotencyOutcome;
  task?: RuntimeTaskCard;
}

export interface CreateRuntimeTaskRequest {
  patientId: PatientId;
  patientDisplayName: string;
  carePlanInstanceId?: CarePlanInstanceId;
  workflowStage?: WorkflowStage;
  runtimeTaskSource: RuntimeTaskSource;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  displayTitle: string;
  description?: string;
  assignedToType: AssignedToType;
  displayToPatient: boolean;
  assignedToStaffId?: Id;
  assignedToStaffDisplayName?: string;
  actionTargetId?: Id;
  completionSourceType?: CompletionSourceType;
  completionSourceReferenceId?: Id;
  dueWindowStart?: EpochMillis;
  dueWindowEnd?: EpochMillis;
  reminderEnabled?: boolean;
  requiredForStageCompletion?: boolean;
  displayAsChecklistItem?: boolean;
  actor?: { actorId: Id; actorType: ActorType };
  reason?: string;
}

export interface CreateRuntimeTaskResponse {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  task: RuntimeTaskCard;
}

export type TaskRuntimeAction = string;

export interface UpdateTaskStateRequest {
  action: TaskRuntimeAction;
  actorId: Id;
  actorType: ActorType;
  expectedCurrentState: RuntimeTaskState;
  reason?: string;
}

export interface UpdateTaskStateResponse {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  currentState: RuntimeTaskState;
  surfaceSection: SurfaceSection;
  historyEntry: TaskStateHistory;
}

export interface UpdateAssignedStaffRequest {
  actorId: Id;
  assignedToStaffId: Id;
  assignedToStaffDisplayName: string;
  reason?: string;
}

export interface UpdateAssignedStaffResponse {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  task: RuntimeTaskCard;
  historyEntry: TaskStateHistory;
}

export interface UpdateReminderSettingsRequest {
  actorId: Id;
  reminderEnabled: boolean;
  reminderSettings?: ReminderSettings;
  reason?: string;
}

export interface UpdateReminderSettingsResponse {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  reminderEnabled: boolean;
  reminderSettings?: ReminderSettings;
  historyEntry: TaskStateHistory;
}

export interface TaskStatusSummaryCounts {
  total: number;
  requiredTotal: number;
  completed: number;
  missed: number;
  active: number;
  scheduled: number;
}

export interface TaskStatusSummaryResponse {
  orgId: OrgId;
  patientId: PatientId;
  carePlanInstanceId: CarePlanInstanceId;
  workflowStage?: WorkflowStage;
  readinessStatus: ReadinessStatus;
  counts: TaskStatusSummaryCounts;
  incompleteRequiredTasks?: Array<{
    runtimeTaskInstanceId: RuntimeTaskInstanceId;
    displayTitle: string;
    requiredForStageCompletion?: boolean;
    currentState: RuntimeTaskState;
  }>;
}

// =============================================================================
// Inbound events (§5.3)
// =============================================================================

export interface CarePlanTaskGenerationTriggeredEvent {
  patientId: PatientId;
  carePlanInstanceId: CarePlanInstanceId;
  taskGenerationTrigger: string;
  triggerTimestamp: EpochMillis;
}

export interface MonitoringActionRequestedEvent {
  patientId: PatientId;
  carePlanInstanceId: CarePlanInstanceId;
  monitoringInstanceId: Id;
  taskBehaviorCode: TaskBehaviorCode;
  dueWindowStart: EpochMillis;
  dueWindowEnd: EpochMillis;
  reminderContext?: Record<string, unknown>;
}

/** Option B requires patientId for patient-partition query (no completion GSI). */
export interface LinkedSourceObjectCompletedEvent {
  patientId: PatientId;
  completionSourceType: CompletionSourceType;
  completionSourceReferenceId: Id;
  completedAt: EpochMillis;
  completionEventId: Id;
}

export interface SchedulerWindowExecutionEvent {
  runWindowStart: EpochMillis;
  runWindowEnd: EpochMillis;
  batchId: Id;
}

export interface ServiceFlowActivatedEvent {
  patientId: PatientId;
  orgId?: OrgId;
  triggerTimestamp: EpochMillis;
  taskPayload?: Omit<CreateRuntimeTaskRequest, 'patientId'>;
}

// =============================================================================
// Outbound commands (no DynamoDB rows)
// =============================================================================

export interface RegisterReminderJobsCommand {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  patientId: PatientId;
  reminderRecordId?: Id;
  scheduledReminderAt?: EpochMillis;
  reminderChannel?: ReminderChannel;
}

export interface CancelReminderJobsCommand {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  patientId?: PatientId;
  reminderRecordId?: Id;
  reason?: string;
}

export interface SendReminderRequestCommand {
  runtimeTaskInstanceId: RuntimeTaskInstanceId;
  patientId: PatientId;
  reminderRecordId: Id;
  reminderChannel: ReminderChannel;
  scheduledReminderAt: EpochMillis;
}
