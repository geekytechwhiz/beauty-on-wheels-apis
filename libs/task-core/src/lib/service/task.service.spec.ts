import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateMonitoringActionPayload } from '../models/api/create-monitoring-action.types';
import type { CreateRuntimeTaskPayload } from '../models/api/create-runtime-task.types';
import { RUNTIME_TASK_SOURCE } from '../models/types/task-domain.types';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { TaskRepository } from '../repositories/task-repository';
import { TaskService } from './task.service';

function basePayload(): CreateMonitoringActionPayload {
  return {
    organizationId: 'org-1',
    patientId: 'pat-1',
    carePlanInstanceId: 'cp-1',
    monitoringInstanceId: 'mon-1',
    taskBehaviorCode: 'METRIC_CHECKIN',
    dueWindowStart: 1780581600000,
    dueWindowEnd: 1780668000000,
  };
}

function sampleRecord(): TaskMetaDdbRecord {
  return {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Record your health metrics',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'active',
    dueWindowStart: 1780581600000,
    dueWindowEnd: 1780668000000,
    createdAt: 1780581600000,
    createdBy: 'system:monitoring-runtime',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system:monitoring-runtime',
  };
}

describe('TaskService.createMonitoringAction', () => {
  const payload = basePayload();

  it('returns SkippedDuplicate when natural key already exists for same org', async () => {
    const record = sampleRecord();
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue(record),
      createMonitoringTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.createMonitoringAction(payload);

    expect(result).toEqual({ record, outcome: 'skippedDuplicate' });
    expect(repo.createMonitoringTask).not.toHaveBeenCalled();
  });

  it('returns Created when transact succeeds', async () => {
    const record = sampleRecord();
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue('missing'),
      createMonitoringTask: jest.fn().mockResolvedValue(record),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.createMonitoringAction(payload);

    expect(result).toEqual({ record, outcome: 'created' });
  });

  it('throws 409 when duplicate resolves to foreign org', async () => {
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue('foreign_org'),
      createMonitoringTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(svc.createMonitoringAction(payload)).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_USE',
    });
  });

  it('returns SkippedDuplicate after transaction race', async () => {
    const record = sampleRecord();
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest
        .fn()
        .mockResolvedValueOnce('missing')
        .mockResolvedValueOnce(record),
      createMonitoringTask: jest.fn().mockRejectedValue(new DuplicateTaskError('rtask-abc')),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.createMonitoringAction(payload);

    expect(result).toEqual({ record, outcome: 'skippedDuplicate' });
  });
});

function runtimePayload(): CreateRuntimeTaskPayload {
  return {
    organizationId: 'org-1',
    createdBy: 'user:staff-1',
    patientId: 'pat-1',
    runtimeTaskSource: RUNTIME_TASK_SOURCE.MANUAL_SYSTEM,
    taskBehaviorCode: 'CARE_TEAM_TASK',
    taskDisplayGroup: 'staffTask',
    displayTitle: 'Follow up call',
    assignedToType: 'careTeam',
    displayToPatient: false,
    ownerType: 'user',
    ownerUserId: 'staff-1',
  };
}

describe('TaskService.createRuntimeTask', () => {
  it('returns record on successful create', async () => {
    const record = {
      ...sampleRecord(),
      runtimeTaskSource: 'manualSystem' as const,
      taskDisplayGroup: 'staffTask' as const,
    };
    const repo = {
      createRuntimeTask: jest.fn().mockResolvedValue(record),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.createRuntimeTask(runtimePayload());

    expect(result).toEqual({ record });
    expect(repo.createRuntimeTask).toHaveBeenCalledWith(runtimePayload());
  });

  it('propagates repository errors', async () => {
    const repo = {
      createRuntimeTask: jest.fn().mockRejectedValue(new Error('ddb failure')),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(svc.createRuntimeTask(runtimePayload())).rejects.toThrow('ddb failure');
  });
});
