import { TaskEntityBuilder } from './task-entity.builder';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import { RUNTIME_TASK_SOURCE } from '../models/types/task-domain.types';

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

  const staffInput: CreateRuntimeTaskRequest = {
    organizationId: 'org-acme-health-001',
    createdBy: 'user:staff-lead-001',
    patientId: 'pat-8f2c91a4-7e3b-4d1a-9c55-2a1f0e883201',
    carePlanInstanceId: 'cp-inst-onboard-2026-04-001',
    workflowStage: 'ongoing',
    runtimeTaskSource: RUNTIME_TASK_SOURCE.MANUAL_SYSTEM,
    taskBehaviorCode: 'CARE_TEAM_TASK',
    taskDisplayGroup: 'staffTask',
    displayTitle: 'Call patient about missed reading',
    assignedToType: 'careTeam',
    ownerType: 'user',
    ownerUserId: 'staff-nurse-44721',
    ownerDisplayName: 'Nurse Lee',
    displayToPatient: false,
    dueWindowStart: 1780567200000,
    dueWindowEnd: 1780650000000,
    reminderEnabled: false,
  };

  it('builds runtime META for staff manualSystem task with GSI1', () => {
    const ctx = TaskEntityBuilder.buildRuntimeTaskCreateContext({
      input: staffInput,
      runtimeTaskInstanceId: 'rtask-staff-call-001',
      nowMs: 1780567200000,
    });

    const meta = TaskEntityBuilder.buildRuntimeMetaRecord(ctx);
    expect(meta.runtimeTaskSource).toBe('manualSystem');
    expect(meta.taskDisplayGroup).toBe('staffTask');
    expect(meta.assignedToStaffId).toBe('staff-nurse-44721');
    expect(meta.ownerType).toBe('user');
    expect(meta.gsi1Pk).toBe('ORG#org-acme-health-001#STAFF#staff-nurse-44721');
    expect(meta.gsi1Sk).toContain('PAT#pat-8f2c91a4-7e3b-4d1a-9c55-2a1f0e883201');
    expect(meta.currentState).toBe('active');
    expect(meta.createdBy).toBe('user:staff-lead-001');
  });

  it('builds runtime LOOKUP and HIST for serviceFlowRuntime patient task', () => {
    const patientInput: CreateRuntimeTaskRequest = {
      organizationId: 'org-1',
      createdBy: 'system:service-flow-runtime',
      patientId: 'pat-1',
      runtimeTaskSource: RUNTIME_TASK_SOURCE.SERVICE_FLOW_RUNTIME,
      taskBehaviorCode: 'INSTRUCTION',
      taskDisplayGroup: 'action',
      displayTitle: 'Complete device setup',
      assignedToType: 'patient',
      displayToPatient: true,
      dueWindowEnd: 1780668000000,
      displayAsChecklistItem: true,
    };

    const ctx = TaskEntityBuilder.buildRuntimeTaskCreateContext({
      input: patientInput,
      runtimeTaskInstanceId: 'rtask-patient-001',
      nowMs: 1780581600000,
    });

    const meta = TaskEntityBuilder.buildRuntimeMetaRecord(ctx);
    const lookup = TaskEntityBuilder.buildRuntimeLookupRecord(ctx);
    const hist = TaskEntityBuilder.buildRuntimeCreateHistRecord(ctx);

    expect(meta.runtimeTaskSource).toBe('serviceFlowRuntime');
    expect(meta.displayAsChecklistItem).toBe(true);
    expect(meta.dueWindowStart).toBe(1780668000000);
    expect(meta.dueWindowEnd).toBe(1780668000000);
    expect(lookup.dueWindowStart).toBe(1780668000000);
    expect(meta.gsi1Pk).toBeUndefined();
    expect(lookup.taskSk).toBe(meta.sk);
    expect(hist.transitionSource).toBe('system');
    expect(hist.transitionReason).toBe('serviceFlowRuntime create');
  });
});
