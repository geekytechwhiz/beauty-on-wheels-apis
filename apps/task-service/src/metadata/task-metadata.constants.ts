/** Metadata registry type codes used by task-service (value codes live in metadata-registry DB only). */
export const TASK_METADATA_TYPE = {
  TASK_BEHAVIOR_CODE: 'TaskBehaviorCode',
  TASK_DISPLAY_GROUP: 'TaskDisplayGroup',
  RUNTIME_TASK_SOURCE: 'RuntimeTaskSource',
  CURRENT_STATE: 'CurrentState',
  SURFACE_SECTION: 'SurfaceSection',
  WORKFLOW_STAGE: 'WorkflowStage',
  ASSIGNED_TO_TYPE: 'AssignedToType',
  COMPLETION_SOURCE_TYPE: 'CompletionSourceType',
  TRANSITION_SOURCE: 'TransitionSource',
  REMINDER_CHANNEL: 'ReminderChannel',
  REMINDER_STATUS: 'ReminderStatus',
  READINESS_STATUS: 'ReadinessStatus',
  /** Care-plan generate APIs — not in TASK-module Excel sheet but used at runtime. */
  TASK_GENERATION_TRIGGER: 'TaskGenerationTrigger',
} as const;

export type TaskMetadataTypeCode = (typeof TASK_METADATA_TYPE)[keyof typeof TASK_METADATA_TYPE];

/** All registry metadata type codes for task-service (including care-plan trigger). */
export const TASK_METADATA_TYPE_CODES: readonly TaskMetadataTypeCode[] = [
  TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE,
  TASK_METADATA_TYPE.TASK_DISPLAY_GROUP,
  TASK_METADATA_TYPE.RUNTIME_TASK_SOURCE,
  TASK_METADATA_TYPE.CURRENT_STATE,
  TASK_METADATA_TYPE.SURFACE_SECTION,
  TASK_METADATA_TYPE.WORKFLOW_STAGE,
  TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
  TASK_METADATA_TYPE.COMPLETION_SOURCE_TYPE,
  TASK_METADATA_TYPE.TRANSITION_SOURCE,
  TASK_METADATA_TYPE.REMINDER_CHANNEL,
  TASK_METADATA_TYPE.REMINDER_STATUS,
  TASK_METADATA_TYPE.READINESS_STATUS,
  TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER,
];

/** Task-module metadata type codes (excludes TaskGenerationTrigger). */
export const TASK_MODULE_METADATA_TYPE_CODES: readonly TaskMetadataTypeCode[] =
  TASK_METADATA_TYPE_CODES.filter((code) => code !== TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER);

export const TASK_FIELD_TO_METADATA_TYPE = {
  taskBehaviorCode: TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE,
  taskDisplayGroup: TASK_METADATA_TYPE.TASK_DISPLAY_GROUP,
  assignedToType: TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
  workflowStage: TASK_METADATA_TYPE.WORKFLOW_STAGE,
  taskGenerationTrigger: TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER,
  completionSourceType: TASK_METADATA_TYPE.COMPLETION_SOURCE_TYPE,
  runtimeTaskSource: TASK_METADATA_TYPE.RUNTIME_TASK_SOURCE,
  currentState: TASK_METADATA_TYPE.CURRENT_STATE,
  surfaceSection: TASK_METADATA_TYPE.SURFACE_SECTION,
  transitionSource: TASK_METADATA_TYPE.TRANSITION_SOURCE,
  reminderStatus: TASK_METADATA_TYPE.REMINDER_STATUS,
  readinessStatus: TASK_METADATA_TYPE.READINESS_STATUS,
  reminderChannel: TASK_METADATA_TYPE.REMINDER_CHANNEL,
} as const;

export type TaskMetadataFieldKey = keyof typeof TASK_FIELD_TO_METADATA_TYPE;
