import { TASK_METADATA_TYPE } from './task-metadata.constants';
import { normalizeMetadataLookupKey } from './task-metadata.codes';

describe('task-metadata.codes', () => {
  it('normalizes ReminderChannel wire values to registry keys', () => {
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.REMINDER_CHANNEL, 'push')).toBe('PUSH');
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.REMINDER_CHANNEL, 'inApp')).toBe('IN_APP');
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.REMINDER_CHANNEL, 'IN_APP')).toBe('IN_APP');
  });

  it('normalizes AssignedToType aliases', () => {
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'orgStaff')).toBe('orgStaff');
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'staff')).toBe('orgStaff');
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'PATIENT')).toBe('patient');
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'ORG_STAFF')).toBe('orgStaff');
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'careTeamRole')).toBe('careTeamRole');
  });

  it('uppercases task behavior codes for lookup', () => {
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.TASK_BEHAVIOR, 'metric_checkin')).toBe('METRIC_CHECKIN');
  });

  it('normalizes TaskGenerationTrigger wire aliases to catalog codes', () => {
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER, 'carePlanActivated')).toBe(
      'carePlanActivated',
    );
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER, 'stageActivated')).toBe(
      'carePlanStageEntered',
    );
    expect(normalizeMetadataLookupKey(TASK_METADATA_TYPE.TASK_GENERATION_TRIGGER, 'STAGE_ENTERED')).toBe(
      'carePlanStageEntered',
    );
  });
});
