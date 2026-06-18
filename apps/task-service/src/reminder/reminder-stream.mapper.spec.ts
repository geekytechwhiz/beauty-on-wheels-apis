import {
  deriveCancelReason,
  mapMetaToCancelRequest,
  mapMetaToRegisterRequest,
  scheduledReminderAtFromMeta,
} from './reminder-stream.mapper';

describe('reminder-stream.mapper', () => {
  const baseMeta = {
    entityType: 'RuntimeTaskInstance' as const,
    runtimeTaskInstanceId: 'task-1',
    orgId: 'org-1',
    patientId: 'pat-1',
    reminderEnabled: true,
    reminderSettings: { channels: ['push'] },
    currentState: 'open',
    dueWindowStart: 1_700_000_000_000,
    dueWindowEnd: 1_700_000_360_000,
  };

  it('prefers dueWindowEnd for scheduledAt', () => {
    expect(scheduledReminderAtFromMeta(baseMeta)).toBe(baseMeta.dueWindowEnd);
  });

  it('maps META to register request', () => {
    expect(mapMetaToRegisterRequest(baseMeta, 'corr-1')).toEqual({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: baseMeta.dueWindowEnd,
      channel: 'push',
      correlationId: 'corr-1',
    });
  });

  it('derives cancel reason for disabled reminders', () => {
    expect(deriveCancelReason({ ...baseMeta, reminderEnabled: false })).toBe('remindersDisabled');
  });

  it('derives cancel reason for terminal state', () => {
    expect(
      deriveCancelReason({ ...baseMeta, reminderEnabled: true, currentState: 'completed' }),
    ).toBe('taskTerminalState:completed');
  });

  it('maps META to cancel request', () => {
    expect(mapMetaToCancelRequest({ ...baseMeta, reminderEnabled: false })).toEqual({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      reason: 'remindersDisabled',
    });
  });
});
