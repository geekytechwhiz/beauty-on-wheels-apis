import { TASK_METADATA_TYPE } from './task-metadata.constants';

const REMINDER_CHANNEL_WIRE_TO_REGISTRY: Record<string, string> = {
  push: 'PUSH',
  sms: 'SMS',
  email: 'EMAIL',
  inapp: 'IN_APP',
  in_app: 'IN_APP',
};

const REMINDER_CHANNEL_REGISTRY_TO_WIRE: Record<string, string> = {
  PUSH: 'push',
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'inApp',
};

const ASSIGNED_TO_TYPE_WIRE_TO_REGISTRY: Record<string, string> = {
  patient: 'patient',
  orgstaff: 'orgStaff',
  org_staff: 'orgStaff',
  staff: 'orgStaff',
  careteamrole: 'careTeamRole',
  care_team_role: 'careTeamRole',
  user: 'user',
  system: 'system',
};

const TASK_GENERATION_TRIGGER_WIRE_TO_REGISTRY: Record<string, string> = {
  careplanactivated: 'carePlanActivated',
  care_plan_activated: 'carePlanActivated',
  stageactivated: 'carePlanStageEntered',
  careplanstageentered: 'carePlanStageEntered',
  stage_entered: 'carePlanStageEntered',
  manualregeneration: 'manualRegeneration',
  manual_regeneration: 'manualRegeneration',
};

function normalizeAssignedToTypeKey(value: string): string {
  const upper = value.toUpperCase();
  if (upper === 'PATIENT') return 'patient';
  if (upper === 'ORG_STAFF' || upper === 'ORGSTAFF') return 'orgStaff';
  const lower = value.toLowerCase();
  return ASSIGNED_TO_TYPE_WIRE_TO_REGISTRY[lower] ?? value;
}

function normalizeTaskGenerationTriggerKey(value: string): string {
  const compact = value.replace(/_/g, '').toLowerCase();
  const mapped =
    TASK_GENERATION_TRIGGER_WIRE_TO_REGISTRY[compact] ??
    TASK_GENERATION_TRIGGER_WIRE_TO_REGISTRY[value.toLowerCase()];
  if (mapped) return mapped;
  return value;
}

/** Normalizes wire and registry value codes to a single lookup key per metadata type. */
export function normalizeMetadataLookupKey(metadataType: string, valueCode: string): string {
  const trimmed = valueCode.trim();
  if (!trimmed) return '';

  if (metadataType === TASK_METADATA_TYPE.REMINDER_CHANNEL) {
    const upper = trimmed.toUpperCase();
    if (REMINDER_CHANNEL_REGISTRY_TO_WIRE[upper]) {
      return upper;
    }
    const mapped = REMINDER_CHANNEL_WIRE_TO_REGISTRY[trimmed.toLowerCase()];
    return mapped ?? upper;
  }

  if (metadataType === TASK_METADATA_TYPE.ASSIGNED_TO_TYPE) {
    return normalizeAssignedToTypeKey(trimmed);
  }

  if (metadataType === TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER) {
    return normalizeTaskGenerationTriggerKey(trimmed);
  }

  if (metadataType === TASK_METADATA_TYPE.TASK_BEHAVIOR) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}
