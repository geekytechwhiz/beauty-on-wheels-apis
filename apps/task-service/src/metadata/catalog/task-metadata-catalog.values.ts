import { TASK_METADATA_TYPE } from '../task-metadata.constants';

import type { TaskMetadataValueSeed } from './catalog-seed.types';

function scoped(
  code: string,
  label: string,
  modules: string[],
  sortOrder?: number,
): TaskMetadataValueSeed {
  return {
    metadataValueCode: code,
    label,
    applicableModules: modules,
    sortOrder,
  };
}

const TASK_MODULES = ['TASK'] as const;
const TASK_TEMPLATE_MODULES = ['TASK', 'TEMPLATE'] as const;
const CARE_PLAN_TASK_MODULES = ['TASK', 'TEMPLATE', 'CARE_PLAN'] as const;
const TASK_ALERT_MODULES = ['TASK', 'ALERT'] as const;
const MONITORING_TEMPLATE_MODULES = ['TEMPLATE', 'MONITORING', 'ALERT'] as const;

/** Task-service metadata value seeds (registry seed reference; wire codes match API persistence). */
export const TASK_METADATA_VALUE_SEEDS: Record<string, TaskMetadataValueSeed[]> = {
  [TASK_METADATA_TYPE.TASK_BEHAVIOR]: [
    scoped('INSTRUCTION', 'Instruction', [...TASK_TEMPLATE_MODULES], 1),
    scoped('DOCUMENT_FORM', 'Document Form', [...TASK_TEMPLATE_MODULES], 2),
    scoped('UPLOAD_DOCUMENT', 'Upload Document', [...TASK_TEMPLATE_MODULES], 3),
    scoped('DEVICE_SETUP', 'Device Setup', [...TASK_TEMPLATE_MODULES], 4),
    scoped('EDUCATION_VIDEO', 'Education Video', [...TASK_TEMPLATE_MODULES], 5),
    scoped('EDUCATION_ARTICLE', 'Education Article', [...TASK_TEMPLATE_MODULES], 6),
    scoped('CARE_TEAM_TASK', 'Care Team Task', [...TASK_TEMPLATE_MODULES], 7),
    scoped('METRIC_CHECKIN', 'Metric Check-in', [...TASK_TEMPLATE_MODULES], 8),
    scoped('SYMPTOM_CHECKIN', 'Symptom Check-in', [...TASK_TEMPLATE_MODULES], 9),
  ],
  [TASK_METADATA_TYPE.TASK_DISPLAY_GROUP]: [
    scoped('action', 'Action', [...TASK_MODULES], 1),
    scoped('learning', 'Learning', [...TASK_MODULES], 2),
    scoped('checkIn', 'Check-in', [...TASK_MODULES], 3),
    scoped('staffTask', 'Staff Task', [...TASK_MODULES], 4),
  ],
  [TASK_METADATA_TYPE.TASK_WORKFLOW_STAGE]: [
    scoped('onboarding', 'Onboarding', [...CARE_PLAN_TASK_MODULES], 1),
    scoped('ongoing', 'Ongoing', [...CARE_PLAN_TASK_MODULES], 2),
    scoped('review', 'Review', [...CARE_PLAN_TASK_MODULES], 3),
    scoped('closure', 'Closure', [...CARE_PLAN_TASK_MODULES], 4),
  ],
  [TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER]: [
    scoped('carePlanActivated', 'Care Plan Activated', [...CARE_PLAN_TASK_MODULES], 1),
    scoped('carePlanStageEntered', 'Stage Entered', [...CARE_PLAN_TASK_MODULES], 2),
    scoped('manualRegeneration', 'Manual Regeneration', [...CARE_PLAN_TASK_MODULES], 3),
  ],
  [TASK_METADATA_TYPE.COMPLETION_SOURCE_TYPE]: [
    scoped('manual', 'Manual', [...TASK_TEMPLATE_MODULES], 1),
    scoped('document', 'Document', [...TASK_TEMPLATE_MODULES], 2),
    scoped('education', 'Education', [...TASK_TEMPLATE_MODULES], 3),
    scoped('deviceSetup', 'Device Setup', [...TASK_TEMPLATE_MODULES], 4),
    scoped('monitoring', 'Monitoring', [...TASK_TEMPLATE_MODULES], 5),
    scoped('symptom', 'Symptom', [...TASK_TEMPLATE_MODULES], 6),
  ],
  [TASK_METADATA_TYPE.RUNTIME_TASK_SOURCE]: [
    scoped('carePlanTaskLinkage', 'Care Plan Task Linkage', [...TASK_MODULES], 1),
    scoped('monitoringRuntime', 'Monitoring Runtime', [...TASK_MODULES], 2),
    scoped('serviceFlowRuntime', 'Service Flow Runtime', [...TASK_MODULES], 3),
    scoped('manualSystem', 'Manual System', [...TASK_MODULES], 4),
  ],
  [TASK_METADATA_TYPE.ASSIGNED_TO_TYPE]: [
    scoped('patient', 'Patient', [...TASK_ALERT_MODULES], 1),
    scoped('orgStaff', 'Org Staff', [...TASK_ALERT_MODULES], 2),
    scoped('careTeamRole', 'Care Team Role', [...TASK_ALERT_MODULES], 3),
    scoped('user', 'User', [...TASK_ALERT_MODULES], 4),
    scoped('system', 'System', [...TASK_ALERT_MODULES], 5),
  ],
  [TASK_METADATA_TYPE.REMINDER_CHANNEL]: [
    scoped('SMS', 'SMS', [...TASK_ALERT_MODULES, 'SYMPTOM'], 1),
    scoped('EMAIL', 'Email', [...TASK_ALERT_MODULES, 'SYMPTOM'], 2),
    scoped('PUSH', 'Push', [...TASK_ALERT_MODULES, 'SYMPTOM'], 3),
    scoped('IN_APP', 'In-App', [...TASK_ALERT_MODULES, 'SYMPTOM'], 4),
  ],
  MissedMonitoringAction: [
    scoped('CREATE_ALERT', 'Create Alert', [...MONITORING_TEMPLATE_MODULES], 1),
    scoped('NONE', 'None', [...MONITORING_TEMPLATE_MODULES], 2),
    scoped('TRACK_ONLY', 'Track Only', [...MONITORING_TEMPLATE_MODULES], 3),
  ],
};
