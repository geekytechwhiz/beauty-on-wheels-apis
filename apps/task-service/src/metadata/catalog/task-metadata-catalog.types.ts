import { TASK_METADATA_TYPE } from '../task-metadata.constants';

import type { TaskMetadataTypeSeedDefinition } from './catalog-seed.types';

const enumType = (
  code: string,
  displayName: string,
  multiSelect: boolean,
  applicableModules: string[],
): TaskMetadataTypeSeedDefinition => ({
  metadataTypeCode: code,
  displayName,
  valueDataType: 'Enum',
  multiSelectAllowed: multiSelect,
  status: 'ACTIVE',
  applicableModules,
  valueApplicabilityConfig: { moduleScoped: true },
});

/** Task-service metadata type definitions (registry seed reference). */
export const TASK_METADATA_TYPE_DEFINITIONS: TaskMetadataTypeSeedDefinition[] = [
  enumType(TASK_METADATA_TYPE.TASK_BEHAVIOR, 'Task Behavior', false, ['TASK', 'TEMPLATE', 'MONITORING']),
  enumType(TASK_METADATA_TYPE.TASK_DISPLAY_GROUP, 'Task Display Group', false, ['TASK', 'TEMPLATE']),
  enumType(TASK_METADATA_TYPE.TASK_WORKFLOW_STAGE, 'Task Workflow Stage', false, ['TASK', 'TEMPLATE', 'CARE_PLAN']),
  {
    ...enumType(TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER, 'Task Generation Trigger', false, [
      'TASK',
      'TEMPLATE',
      'CARE_PLAN',
    ]),
    relation: {
      supportsRelations: true,
      relationType: 'VALID_IN',
      targetMetadataTypeCode: TASK_METADATA_TYPE.TASK_WORKFLOW_STAGE,
      relationFieldLabel: 'Workflow Stage',
      selectionMode: 'SINGLE',
      relationRequired: false,
    },
  },
  enumType(TASK_METADATA_TYPE.COMPLETION_SOURCE_TYPE, 'Completion Source Type', false, ['TASK', 'TEMPLATE']),
  enumType(TASK_METADATA_TYPE.RUNTIME_TASK_SOURCE, 'Runtime Task Source', false, ['TASK']),
  enumType(TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'Assigned To Type', false, ['TASK', 'ALERT']),
  enumType(TASK_METADATA_TYPE.REMINDER_CHANNEL, 'Reminder Channel', true, ['TASK', 'SYMPTOM', 'ALERT']),
  enumType('MissedMonitoringAction', 'Missed Monitoring Action', true, ['TEMPLATE', 'MONITORING', 'ALERT']),
];

/** Seed ordering: TaskGenerationTrigger values depend on TaskWorkflowStage. */
export const TASK_METADATA_RELATION_DEPENDENCIES: Record<string, string> = {
  [TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER]: TASK_METADATA_TYPE.TASK_WORKFLOW_STAGE,
};
