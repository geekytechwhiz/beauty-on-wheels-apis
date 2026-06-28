/** Metadata registry type codes used by task-service. */
export const TASK_METADATA_TYPE = {
  TASK_BEHAVIOR: 'TaskBehavior',
  TASK_DISPLAY_GROUP: 'TaskDisplayGroup',
  ASSIGNED_TO_TYPE: 'AssignedToType',
  TASK_WORKFLOW_STAGE: 'TaskWorkflowStage',
  TASK_GENERATION_TRIGGER: 'TaskGenerationTrigger',
  COMPLETION_SOURCE_TYPE: 'CompletionSourceType',
  REMINDER_CHANNEL: 'ReminderChannel',
  RUNTIME_TASK_SOURCE: 'RuntimeTaskSource',
} as const;

export type TaskMetadataTypeCode = (typeof TASK_METADATA_TYPE)[keyof typeof TASK_METADATA_TYPE];

export const TASK_FIELD_TO_METADATA_TYPE = {
  taskBehaviorCode: TASK_METADATA_TYPE.TASK_BEHAVIOR,
  taskDisplayGroup: TASK_METADATA_TYPE.TASK_DISPLAY_GROUP,
  assignedToType: TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
  workflowStage: TASK_METADATA_TYPE.TASK_WORKFLOW_STAGE,
  taskGenerationTrigger: TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER,
  completionSourceType: TASK_METADATA_TYPE.COMPLETION_SOURCE_TYPE,
  runtimeTaskSource: TASK_METADATA_TYPE.RUNTIME_TASK_SOURCE,
  reminderChannel: TASK_METADATA_TYPE.REMINDER_CHANNEL,
} as const;

export type TaskMetadataFieldKey = keyof typeof TASK_FIELD_TO_METADATA_TYPE;

export const TASK_METADATA_LABEL_FIELDS: Record<TaskMetadataFieldKey, string> = {
  taskBehaviorCode: 'taskBehaviorCodeLabel',
  taskDisplayGroup: 'taskDisplayGroupLabel',
  assignedToType: 'assignedToTypeLabel',
  workflowStage: 'workflowStageLabel',
  taskGenerationTrigger: 'taskGenerationTriggerLabel',
  completionSourceType: 'completionSourceTypeLabel',
  runtimeTaskSource: 'runtimeTaskSourceLabel',
  reminderChannel: 'reminderChannelLabel',
};
