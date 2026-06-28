import {
  TASK_FIELD_TO_METADATA_TYPE,
  type TaskMetadataFieldKey,
} from './task-metadata.constants';

export type TaskMetadataWriteOperation =
  | 'postMonitoringAction'
  | 'postRuntimeTask'
  | 'postGenerateCarePlan'
  | 'patchRuntimeTask'
  | 'putReminderSettings';

/** All metadata types that may appear on a runtime task card response. */
export const TASK_CARD_METADATA_TYPE_CODES: readonly string[] = [
  ...new Set(Object.values(TASK_FIELD_TO_METADATA_TYPE)),
];

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function hasReminderChannels(settings: { channels?: string[] } | null | undefined): boolean {
  return Array.isArray(settings?.channels) && settings.channels.length > 0;
}

function addFieldType(types: Set<string>, field: TaskMetadataFieldKey): void {
  types.add(TASK_FIELD_TO_METADATA_TYPE[field]);
}

/** Metadata type codes present on a write request for a given API (minimal registry fetch). */
export function collectMetadataTypeCodesFromWritePayload(
  operation: TaskMetadataWriteOperation,
  payload: unknown,
): string[] {
  const types = new Set<string>();

  switch (operation) {
    case 'postMonitoringAction': {
      const body = payload as {
        taskBehaviorCode?: string;
        assignedToType?: string;
        reminderContext?: { channels?: string[] } | null;
      };
      if (hasNonEmptyString(body.taskBehaviorCode)) addFieldType(types, 'taskBehaviorCode');
      if (hasNonEmptyString(body.assignedToType)) addFieldType(types, 'assignedToType');
      if (hasReminderChannels(body.reminderContext ?? undefined)) addFieldType(types, 'reminderChannel');
      break;
    }
    case 'postRuntimeTask': {
      const body = payload as {
        runtimeTaskSource?: string;
        taskBehaviorCode?: string;
        taskDisplayGroup?: string;
        assignedToType?: string;
        workflowStage?: string;
        completionSourceType?: string | null;
        reminderEnabled?: boolean;
        reminderSettings?: { channels?: string[] } | null;
      };
      if (hasNonEmptyString(body.runtimeTaskSource)) addFieldType(types, 'runtimeTaskSource');
      if (hasNonEmptyString(body.taskBehaviorCode)) addFieldType(types, 'taskBehaviorCode');
      if (hasNonEmptyString(body.taskDisplayGroup)) addFieldType(types, 'taskDisplayGroup');
      if (hasNonEmptyString(body.assignedToType)) addFieldType(types, 'assignedToType');
      if (hasNonEmptyString(body.workflowStage)) addFieldType(types, 'workflowStage');
      if (hasNonEmptyString(body.completionSourceType)) addFieldType(types, 'completionSourceType');
      if (body.reminderEnabled && hasReminderChannels(body.reminderSettings ?? undefined)) {
        addFieldType(types, 'reminderChannel');
      }
      break;
    }
    case 'postGenerateCarePlan': {
      const body = payload as {
        taskGenerationTrigger?: string;
        workflowStage?: string;
        sourceLinkageContext?: {
          linkages?: Array<{
            taskBehaviorCode?: string;
            taskDisplayGroup?: string;
            assignedToType?: string;
            completionSourceType?: string | null;
            reminderSettings?: { channels?: string[] } | null;
          }>;
        };
      };
      if (hasNonEmptyString(body.taskGenerationTrigger)) addFieldType(types, 'taskGenerationTrigger');
      if (hasNonEmptyString(body.workflowStage)) addFieldType(types, 'workflowStage');
      for (const linkage of body.sourceLinkageContext?.linkages ?? []) {
        if (hasNonEmptyString(linkage.taskBehaviorCode)) addFieldType(types, 'taskBehaviorCode');
        if (hasNonEmptyString(linkage.taskDisplayGroup)) addFieldType(types, 'taskDisplayGroup');
        if (hasNonEmptyString(linkage.assignedToType)) addFieldType(types, 'assignedToType');
        if (hasNonEmptyString(linkage.completionSourceType)) addFieldType(types, 'completionSourceType');
        if (hasReminderChannels(linkage.reminderSettings ?? undefined)) addFieldType(types, 'reminderChannel');
      }
      break;
    }
    case 'patchRuntimeTask': {
      const patch = payload as { workflowStage?: string; completionSourceType?: string | null };
      if (patch.workflowStage !== undefined) addFieldType(types, 'workflowStage');
      if (patch.completionSourceType !== undefined) addFieldType(types, 'completionSourceType');
      break;
    }
    case 'putReminderSettings': {
      const body = payload as { reminderSettings?: { channels?: string[] } | null };
      if (hasReminderChannels(body.reminderSettings ?? undefined)) addFieldType(types, 'reminderChannel');
      break;
    }
    default:
      break;
  }

  return [...types];
}
