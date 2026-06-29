import { TASK_METADATA_TYPE } from './task-metadata.constants';
import { collectMetadataTypeCodesFromWritePayload } from './task-metadata.type-codes';

describe('task-metadata.type-codes', () => {
  it('collects only monitoring-action types present on write payload', () => {
    expect(
      collectMetadataTypeCodesFromWritePayload('postMonitoringAction', {
        taskBehaviorCode: 'METRIC_CHECKIN',
        assignedToType: 'patient',
      }),
    ).toEqual([TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE, TASK_METADATA_TYPE.ASSIGNED_TO_TYPE]);
  });

  it('includes ReminderChannel when reminder channels are on the request', () => {
    expect(
      collectMetadataTypeCodesFromWritePayload('postMonitoringAction', {
        taskBehaviorCode: 'METRIC_CHECKIN',
        assignedToType: 'patient',
        reminderContext: { channels: ['push'] },
      }),
    ).toEqual(
      expect.arrayContaining([
        TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE,
        TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
        TASK_METADATA_TYPE.REMINDER_CHANNEL,
      ]),
    );
  });

  it('collects only patch fields being updated', () => {
    expect(
      collectMetadataTypeCodesFromWritePayload('patchRuntimeTask', {
        workflowStage: 'onboarding',
      }),
    ).toEqual([TASK_METADATA_TYPE.WORKFLOW_STAGE]);
  });
});
