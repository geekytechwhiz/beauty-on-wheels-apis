import { TaskEntityBuilder } from './task-entity.builder';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';

describe('TaskEntityBuilder', () => {
  const input: CreateMonitoringActionRequest = {
    organizationId: 'org-1',
    patientId: 'pat-1',
    carePlanInstanceId: 'cp-1',
    monitoringInstanceId: 'mon-1',
    taskBehaviorCode: 'METRIC_CHECKIN',
    dueWindowStart: 1780581600000,
    dueWindowEnd: 1780668000000,
    reminderContext: { channels: ['Push'] },
  };

  it('builds monitoring META with CheckIn defaults', () => {
    const ctx = TaskEntityBuilder.buildMonitoringCreateContext({
      runtimeTaskInstanceId: 'rtask-abc',
      idempotencyKey: 'org-1|pat-1|mon-1|METRIC_CHECKIN|1780581600000|1780668000000',
      input,
      nowMs: 1780581600000,
    });

    const meta = TaskEntityBuilder.buildMonitoringMetaRecord(ctx);
    expect(meta.runtimeTaskSource).toBe('monitoringRuntime');
    expect(meta.assignedToType).toBe('patient');
    expect(meta.displayToPatient).toBe(true);
    expect(meta.taskDisplayGroup).toBe('checkIn');
    expect(meta.currentState).toBe('active');
    expect(meta.reminderEnabled).toBe(true);
    expect(meta.createdBy).toBe('system:monitoring-runtime');
  });

  it('schedules task when dueWindowStart is in the future', () => {
    const ctx = TaskEntityBuilder.buildMonitoringCreateContext({
      runtimeTaskInstanceId: 'rtask-future',
      idempotencyKey: 'key',
      input,
      nowMs: 1780500000000,
    });

    const meta = TaskEntityBuilder.buildMonitoringMetaRecord(ctx);
    expect(meta.currentState).toBe('scheduled');
  });
});
