/**
 * Runtime Task Management Service — requirements-derived TypeScript contracts
 *
 * Source: `Runtime_Task_Management_Service_Requirements_v2.docx`
 * Extracted text: `Runtime_Task_Management_Service_Requirements_v2.extracted.txt`
 * Aligned with: `open-api.yaml`, `option-b-db-mapping.md`, `requirements-v2-changes.md`
 *
 * Scope:
 * - Domain + persistence-facing shapes (no implementations)
 * - HTTP APIs, inbound events, outbound commands
 * - Option B storage vs API read models (surfaceSection derived, not stored)
 *
 * Naming:
 * - PascalCase field names match requirements §12 / logical model.
 * - API JSON uses camelCase at the wire layer (map in handlers).
 */

/** API + DynamoDB instants (Option B). */
export type EpochMillis = number;

/** Legacy / envelope-only; task payloads use EpochMillis. */
export type ISODateString = string;
export type ID = string;

export type OrgID = ID;
export type PatientID = ID;
export type CarePlanInstanceID = ID;
export type RuntimeTaskInstanceID = ID;

// =============================================================================
// Enums
// =============================================================================

export type RuntimeTaskSource =
  | "CarePlanTaskLinkage"
  | "MonitoringRuntime"
  | "ServiceFlowRuntime"
  | "ManualSystem";

export type TaskBehaviorCode =
  | "INSTRUCTION"
  | "DOCUMENT_FORM"
  | "UPLOAD_DOCUMENT"
  | "DEVICE_SETUP"
  | "EDUCATION_VIDEO"
  | "EDUCATION_ARTICLE"
  | "CARE_TEAM_TASK"
  | "METRIC_CHECKIN"
  | "SYMPTOM_CHECKIN";

export type TaskDisplayGroup = "Action" | "Learning" | "CheckIn" | "StaffTask";

/** Who the task is assigned to (OpenAPI uses ActorType incl. System). */
export type AssignedToType = "Patient" | "CareTeam" | "Provider" | "System";

export type WorkflowStage = "Onboarding" | "Ongoing" | "Review" | "Closure";

export type RuntimeTaskState =
  | "Scheduled"
  | "Active"
  | "Completed"
  | "Missed"
  | "Dismissed"
  | "Cancelled";

/** Where the task appears in mobile/portal — derived at read time (not stored on META). */
export type SurfaceSection =
  | "Today"
  | "Upcoming"
  | "NeedsAttention"
  | "History"
  | "CarePlanChecklist";

/** Action Center query filter — includes All for grouped response. */
export type SurfaceSectionActionCenter = SurfaceSection | "All";

export type TransitionSource = "Manual" | "Scheduler" | "SourceEvent" | "System";

/** Append-only HIST# event kind (OpenAPI / Requirements v2). */
export type TaskHistoryEventType =
  | "StateChange"
  | "OwnerChange"
  | "ReminderSettingsChange"
  | "ReminderRegisterRequest"
  | "ReminderCancelRequest";

export type ReminderChannel = "Push" | "SMS" | "Email" | "InApp";
export type ReminderStatus = "Scheduled" | "Sent" | "Cancelled" | "Failed" | "Suppressed";

export type CompletionSource = "Manual" | "LinkedObject" | "System";

export type CompletionSourceType =
  | "Manual"
  | "Document"
  | "Education"
  | "DeviceSetup"
  | "Monitoring"
  | "Symptom"
  | (string & {});

export type ActorType = "Patient" | "CareTeam" | "Provider" | "System";

/** Requirements v2 — staff / care-manager task ownership. */
export type OwnerType = "User" | "Role" | "Team";

export type IdempotencyOutcome = "Created" | "SkippedDuplicate";

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
 * Does NOT store SurfaceSection (derived in service from state + due window + context).
 * v2 StartDate → DueWindowStart; v2 DueDate → DueWindowEnd (SK ms token = DueWindowStart).
 */
export interface RuntimeTaskInstanceRecord {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  OrgID: OrgID;
  PatientID: PatientID;
  CarePlanInstanceID?: CarePlanInstanceID;
  RuntimeTaskSource: RuntimeTaskSource;
  SourceTaskTemplateVersionID?: ID;
  CarePlanTaskLinkageID?: ID;
  MonitoringInstanceID?: ID;
  TaskBehaviorCode: TaskBehaviorCode;
  TaskDisplayGroup: TaskDisplayGroup;
  ActionTargetID?: ID;
  CompletionSourceType?: CompletionSourceType;
  CompletionSourceReferenceID?: ID;
  DisplayTitle: string;
  Description?: string;
  AssignedToType: AssignedToType;
  /** When OwnerType = User; mirrors OwnerUserID for GSI1 / API. */
  AssignedToStaffID?: ID;
  OwnerType?: OwnerType;
  OwnerUserID?: ID;
  OwnerRoleCode?: string;
  OwnerTeamID?: ID;
  OwnerDisplayName?: string;
  DisplayToPatient: boolean;
  WorkflowStage?: WorkflowStage;
  TaskGenerationTrigger?: string;
  RequiredForStageCompletion?: boolean;
  DisplayAsChecklistItem?: boolean;
  /** v2 StartDate — when task becomes visible; drives META/GSI1 DUE# sort token. */
  DueWindowStart?: EpochMillis;
  /** v2 DueDate — expected completion bound. */
  DueWindowEnd?: EpochMillis;
  /**
   * @deprecated v2 — use DueWindowEnd. Not stored in Option B.
   */
  DueAt?: EpochMillis;
  CurrentState: RuntimeTaskState;
  PrimaryActionLabel?: string;
  DeepLinkTarget?: string;
  ReminderEnabled?: boolean;
  ReminderSettings?: ReminderSettings;
  CreatedAt: EpochMillis;
  CreatedBy: string;
  LastUpdatedAt: EpochMillis;
  LastUpdatedBy: string;
}

/** LOOKUP row on TASK# partition. */
export interface TaskLookupRecord {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  OrgID: OrgID;
  PatientID: PatientID;
  TaskSK: string;
  DueWindowStart?: EpochMillis;
  DueWindowEnd?: EpochMillis;
  CarePlanInstanceID?: CarePlanInstanceID;
  AssignedToStaffID?: ID;
  OwnerType?: OwnerType;
  OwnerUserID?: ID;
  OwnerRoleCode?: string;
  OwnerTeamID?: ID;
  OwnerDisplayName?: string;
  ReminderHistory?: ReminderRecord[];
  EvidenceSummary?: TaskEvidenceSummary;
}

/** @deprecated Use RuntimeTaskInstanceRecord — persisted shape has no SurfaceSection. */
export type RuntimeTaskInstance = RuntimeTaskInstanceRecord;

export interface TaskStateHistory {
  TaskStateHistoryID: ID;
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  HistoryEventType: TaskHistoryEventType;
  FromState?: RuntimeTaskState;
  ToState?: RuntimeTaskState;
  TransitionAt: EpochMillis;
  TransitionBy: string;
  TransitionSource: TransitionSource;
  TransitionReason?: string;
  SourceEventID?: ID;
  /** Ownership reassignment audit (Requirements v2). */
  PreviousOwnerType?: OwnerType;
  PreviousOwnerUserID?: ID;
  PreviousOwnerRoleCode?: string;
  PreviousOwnerTeamID?: ID;
  PreviousOwnerDisplayName?: string;
  NewOwnerType?: OwnerType;
  NewOwnerUserID?: ID;
  NewOwnerRoleCode?: string;
  NewOwnerTeamID?: ID;
  NewOwnerDisplayName?: string;
  /** Reminder settings change audit (Requirements v2 REM-008). */
  PreviousReminderEnabled?: boolean;
  NewReminderEnabled?: boolean;
  PreviousReminderSettings?: ReminderSettings;
  NewReminderSettings?: ReminderSettings;
  ReminderRecordID?: ID;
  ReminderChannel?: ReminderChannel;
  SchedulerJobID?: ID;
  PreviousReminderStatus?: ReminderStatus;
  NewReminderStatus?: ReminderStatus;
}

/** Operational reminder trail on LOOKUP (not HIST#). */
export interface ReminderRecord {
  ReminderRecordID: ID;
  RuntimeTaskInstanceID?: RuntimeTaskInstanceID;
  ScheduledReminderAt: EpochMillis;
  ReminderChannel: ReminderChannel;
  ReminderStatus: ReminderStatus;
  SentAt?: EpochMillis;
  UpdatedAt?: EpochMillis;
  FailureReason?: string;
  SuppressedReason?: string;
  SchedulerJobID?: ID;
}

export interface CompletionEvidence {
  CompletionEvidenceID: ID;
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  OrgID?: OrgID;
  PatientID?: PatientID;
  CompletionSource: CompletionSource;
  CompletionSourceType?: CompletionSourceType;
  CompletionSourceReferenceID?: ID;
  CompletionEventID?: ID;
  CompletedAt: EpochMillis;
  CompletedBy?: string;
  EvidencePayload?: Record<string, unknown>;
}

/** LOOKUP evidenceSummary rollup — SurfaceSection not stored. */
export interface TaskEvidenceSummary {
  TaskEvidenceSummaryID: ID;
  GeneratedAt: EpochMillis;
  RuntimeTaskSource?: RuntimeTaskSource;
  TaskBehaviorCode?: TaskBehaviorCode;
  TaskDisplayGroup?: TaskDisplayGroup;
  CurrentState?: RuntimeTaskState;
  PatientID?: PatientID;
  CarePlanInstanceID?: CarePlanInstanceID;
  RequiredForStageCompletion?: boolean;
  WorkflowStage?: WorkflowStage;
  CompletedAt?: EpochMillis;
  MissedAt?: EpochMillis;
  CompletionSourceType?: CompletionSourceType;
  CompletionSourceReferenceID?: ID;
  LatestCompletionSummary?: string;
}

// =============================================================================
// API read models (derived + projected fields)
// =============================================================================

/**
 * Task card for lists, Action Center, and detail.task.
 * Includes derived SurfaceSection and optional display fields (may be computed).
 */
export interface RuntimeTaskCard extends RuntimeTaskInstanceRecord {
  SurfaceSection: SurfaceSection;
  SurfaceRank?: number;
  DueDisplayText?: string;
  ContextDisplayText?: string;
  IsSurfaceVisible?: boolean;
}

export interface RuntimeTaskDetail {
  Task: RuntimeTaskCard;
  Reminders?: ReminderRecord[];
  CompletionEvidence?: CompletionEvidence[];
  EvidenceSummary?: TaskEvidenceSummary;
}

export interface PaginatedRuntimeTaskCards {
  Items?: RuntimeTaskCard[];
  NextToken?: string;
}

export interface ActionCenterSingleSection {
  SurfaceSection: SurfaceSection;
  Items: RuntimeTaskCard[];
  NextToken?: string;
}

export interface ActionCenterGroupedSections {
  Sections: Partial<Record<SurfaceSection, RuntimeTaskCard[]>>;
  NextToken?: string;
}

export type ActionCenterItems = ActionCenterSingleSection | ActionCenterGroupedSections;

export interface PaginatedTaskHistory {
  Items?: TaskStateHistory[];
  NextToken?: string;
}

// =============================================================================
// HTTP APIs
// =============================================================================

export interface GenerateCarePlanTasksRequest {
  PatientID: PatientID;
  CarePlanInstanceID: CarePlanInstanceID;
  TaskGenerationTrigger: string;
  SourceLinkageContext: {
    Linkages: GenerateCarePlanTaskLinkage[];
  };
  WorkflowStage?: WorkflowStage;
  DryRun?: boolean;
}

export interface GenerateCarePlanTaskLinkage {
  CarePlanTaskLinkageID: ID;
  TaskBehaviorCode: TaskBehaviorCode;
  TaskDisplayGroup: TaskDisplayGroup;
  DisplayTitle: string;
  AssignedToType: AssignedToType;
  DisplayToPatient: boolean;
  DueWindowStart: EpochMillis;
  DueWindowEnd: EpochMillis;
}

export interface GeneratedTaskResult {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  Outcome: IdempotencyOutcome;
  Task?: RuntimeTaskCard;
}

/** Per-task results (OpenAPI / api-mappings). v2 also allows counts-only aggregate. */
export interface GenerateCarePlanTasksResponse {
  Results: GeneratedTaskResult[];
  CreatedCount?: number;
  SkippedDuplicateCount?: number;
  FailureDetails?: Array<{ message: string; code?: string; context?: Record<string, unknown> }>;
}

export interface CreateMonitoringActionRequest {
  PatientID: PatientID;
  CarePlanInstanceID: CarePlanInstanceID;
  MonitoringInstanceID: ID;
  TaskBehaviorCode: TaskBehaviorCode;
  DueWindowStart: EpochMillis;
  DueWindowEnd: EpochMillis;
  ReminderContext?: Record<string, unknown>;
}

export interface CreateMonitoringActionResponse {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  Outcome?: IdempotencyOutcome;
  Task?: RuntimeTaskCard;
}

export interface CreateRuntimeTaskRequest {
  PatientID: PatientID;
  CarePlanInstanceID?: CarePlanInstanceID;
  WorkflowStage?: WorkflowStage;
  RuntimeTaskSource: RuntimeTaskSource;
  TaskBehaviorCode: TaskBehaviorCode;
  TaskDisplayGroup: TaskDisplayGroup;
  DisplayTitle: string;
  Description?: string;
  AssignedToType: AssignedToType;
  DisplayToPatient: boolean;
  /** Initial staff ownership at create (Requirements v2). */
  AssignedToStaffID?: ID;
  OwnerType?: OwnerType;
  OwnerUserID?: ID;
  OwnerRoleCode?: string;
  OwnerTeamID?: ID;
  OwnerDisplayName?: string;
  ActionTargetID?: ID;
  CompletionSourceType?: CompletionSourceType;
  CompletionSourceReferenceID?: ID;
  DueWindowStart?: EpochMillis;
  DueWindowEnd?: EpochMillis;
  ReminderEnabled?: boolean;
  RequiredForStageCompletion?: boolean;
  DisplayAsChecklistItem?: boolean;
  Actor?: { ActorID: ID; ActorType: ActorType };
  Reason?: string;
}

export interface CreateRuntimeTaskResponse {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  Task: RuntimeTaskCard;
}

export type TaskRuntimeAction = string;

export interface UpdateTaskStateRequest {
  Action: TaskRuntimeAction;
  ActorID: ID;
  ActorType: ActorType;
  ExpectedCurrentState: RuntimeTaskState;
  Reason?: string;
}

export interface UpdateTaskStateResponse {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  CurrentState: RuntimeTaskState;
  /** Derived after state change. */
  SurfaceSection: SurfaceSection;
  HistoryEntry: TaskStateHistory;
}

/** PUT /tasks/{id}/reminder-settings (Requirements v2 REM-006–008). */
export interface UpdateReminderSettingsRequest {
  ActorID: ID;
  ReminderEnabled: boolean;
  ReminderSettings?: ReminderSettings;
  Reason?: string;
}

export interface UpdateReminderSettingsResponse {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  ReminderEnabled: boolean;
  ReminderSettings?: ReminderSettings;
  HistoryEntry: TaskStateHistory;
}

/**
 * PUT /tasks/{id}/owner — reassign care-manager/staff task ownership.
 * Initial assign at create uses CreateRuntimeTaskRequest Owner* fields.
 */
export interface UpdateTaskOwnerRequest {
  ActorID: ID;
  OwnerType: OwnerType;
  OwnerUserID?: ID;
  OwnerRoleCode?: string;
  OwnerTeamID?: ID;
  OwnerDisplayName?: string;
  Reason?: string;
}

export interface UpdateTaskOwnerResponse {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  Task: RuntimeTaskCard;
  HistoryEntry: TaskStateHistory;
}

export interface TaskStatusSummaryCounts {
  Total: number;
  RequiredTotal: number;
  Completed: number;
  Missed: number;
  Active: number;
  Scheduled: number;
}

export type ReadinessStatus = "Ready" | "NotReady" | "NotApplicable";

export interface TaskStatusSummaryResponse {
  OrgID: OrgID;
  PatientID: PatientID;
  CarePlanInstanceID: CarePlanInstanceID;
  WorkflowStage?: WorkflowStage;
  ReadinessStatus: ReadinessStatus;
  Counts: TaskStatusSummaryCounts;
  IncompleteRequiredTasks?: Array<{
    RuntimeTaskInstanceID: RuntimeTaskInstanceID;
    DisplayTitle: string;
    RequiredForStageCompletion?: boolean;
    CurrentState: RuntimeTaskState;
  }>;
}

// =============================================================================
// Inbound events (§5.3)
// =============================================================================

export interface CarePlanTaskGenerationTriggeredEvent {
  PatientID: PatientID;
  CarePlanInstanceID: CarePlanInstanceID;
  TaskGenerationTrigger: string;
  TriggerTimestamp: EpochMillis;
}

export interface MonitoringActionRequestedEvent {
  PatientID: PatientID;
  CarePlanInstanceID: CarePlanInstanceID;
  MonitoringInstanceID: ID;
  TaskBehaviorCode: TaskBehaviorCode;
  DueWindowStart: EpochMillis;
  DueWindowEnd: EpochMillis;
  ReminderContext?: Record<string, unknown>;
}

/**
 * Option B requires PatientID for patient-partition query (no completion GSI).
 */
export interface LinkedSourceObjectCompletedEvent {
  PatientID: PatientID;
  CompletionSourceType: CompletionSourceType;
  CompletionSourceReferenceID: ID;
  CompletedAt: EpochMillis;
  CompletionEventID: ID;
}

export interface SchedulerWindowExecutionEvent {
  RunWindowStart: EpochMillis;
  RunWindowEnd: EpochMillis;
  BatchID: ID;
}

/** Maps to CreateRuntimeTaskRequest body. */
export interface ServiceFlowActivatedEvent {
  PatientID: PatientID;
  OrgID?: OrgID;
  TriggerTimestamp: EpochMillis;
  TaskPayload?: Omit<CreateRuntimeTaskRequest, "PatientID">;
}

// =============================================================================
// Outbound commands (no DynamoDB rows)
// =============================================================================

export interface RegisterReminderJobsCommand {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  PatientID: PatientID;
  ReminderRecordID?: ID;
  ScheduledReminderAt?: EpochMillis;
  ReminderChannel?: ReminderChannel;
}

export interface CancelReminderJobsCommand {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  PatientID?: PatientID;
  ReminderRecordID?: ID;
  Reason?: string;
}

export interface SendReminderRequestCommand {
  RuntimeTaskInstanceID: RuntimeTaskInstanceID;
  PatientID: PatientID;
  ReminderRecordID: ID;
  ReminderChannel: ReminderChannel;
  ScheduledReminderAt: EpochMillis;
}
