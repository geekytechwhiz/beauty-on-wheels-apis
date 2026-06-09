import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateMonitoringActionPayload } from '../models/api/create-monitoring-action.types';
import type { CreateRuntimeTaskPayload } from '../models/api/create-runtime-task.types';
import type {
  CreateCarePlanTaskRequest,
  GenerateCarePlanTasksRequest,
} from '../models/api/generate-care-plan.request';
import {
  buildCarePlanTaskIdempotencyKey,
  buildCarePlanTaskKeys,
} from '../utils/monitoring-idempotency';
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

function carePlanBatchPayload(): GenerateCarePlanTasksRequest {
  return {
    organizationId: 'org-1',
    createdBy: 'system:care-plan-runtime',
    patientId: 'pat-1',
    carePlanInstanceId: 'cp-1',
    taskGenerationTrigger: 'carePlanStageEntered',
    linkages: [
      {
        carePlanTaskLinkageId: 'link-1',
        taskBehaviorCode: 'EDUCATION_VIDEO',
        taskDisplayGroup: 'learning',
        displayTitle: 'Watch video',
        assignedToType: 'patient',
        displayToPatient: true,
        dueWindowStart: 1780567200000,
        dueWindowEnd: 1780610400000,
      },
    ],
  };
}

describe('TaskService.generateCarePlanTasks', () => {
  it('returns created result on successful batch create', async () => {
    const record = {
      ...sampleRecord(),
      runtimeTaskSource: 'carePlanTaskLinkage' as const,
      carePlanTaskLinkageId: 'link-1',
    };
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest.fn().mockResolvedValue('missing'),
      createCarePlanTask: jest.fn().mockResolvedValue(record),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.generateCarePlanTasks(carePlanBatchPayload());

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'created',
    });
    expect(repo.createCarePlanTask).toHaveBeenCalledTimes(1);
  });

  it('returns skippedDuplicate when natural key exists', async () => {
    const record = {
      ...sampleRecord(),
      runtimeTaskSource: 'carePlanTaskLinkage' as const,
    };
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest.fn().mockResolvedValue(record),
      createCarePlanTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.generateCarePlanTasks(carePlanBatchPayload());

    expect(result.results[0].outcome).toBe('skippedDuplicate');
    expect(repo.createCarePlanTask).not.toHaveBeenCalled();
  });

  it('dryRun does not call repository writes', async () => {
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-dry',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest.fn(),
      createCarePlanTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.generateCarePlanTasks({ ...carePlanBatchPayload(), dryRun: true });

    expect(result.results[0]).toMatchObject({
      runtimeTaskInstanceId: 'rtask-dry',
      outcome: 'created',
    });
    expect(repo.resolveCarePlanNaturalKey).not.toHaveBeenCalled();
    expect(repo.createCarePlanTask).not.toHaveBeenCalled();
  });
});

function carePlanIdempotencyInput(
  overrides: Partial<CreateCarePlanTaskRequest> = {},
): CreateCarePlanTaskRequest {
  return {
    organizationId: 'org-acme-001',
    createdBy: 'system:care-plan-runtime',
    patientId: 'pat-maria',
    carePlanInstanceId: 'cp-maria-001',
    taskGenerationTrigger: 'carePlanStageEntered',
    carePlanTaskLinkageId: 'link-watch-bp-video',
    taskBehaviorCode: 'EDUCATION_VIDEO',
    taskDisplayGroup: 'learning',
    displayTitle: 'Watch: How to measure BP',
    assignedToType: 'patient',
    displayToPatient: true,
    dueWindowStart: 1780567200000,
    dueWindowEnd: 1780610400000,
    ...overrides,
  };
}

describe('buildCarePlanTaskIdempotencyKey', () => {
  it('builds stable idempotency key and deterministic runtime task id', () => {
    const input = carePlanIdempotencyInput();
    const key = buildCarePlanTaskIdempotencyKey(input);
    expect(key).toBe(
      'org-acme-001|pat-maria|cp-maria-001|link-watch-bp-video|1780567200000|1780610400000',
    );

    const keys = buildCarePlanTaskKeys(input);
    expect(keys.idempotencyKey).toBe(key);
    expect(keys.runtimeTaskInstanceId).toMatch(/^rtask-[a-f0-9]{32}$/);
    expect(keys.generationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildCarePlanTaskKeys(input).runtimeTaskInstanceId).toBe(keys.runtimeTaskInstanceId);
  });

  it('uses resolved dueWindowStart when only dueWindowEnd is set', () => {
    const key = buildCarePlanTaskIdempotencyKey(
      carePlanIdempotencyInput({ dueWindowStart: undefined, dueWindowEnd: 1780610400000 }),
    );
    expect(key).toBe(
      'org-acme-001|pat-maria|cp-maria-001|link-watch-bp-video|1780610400000|1780610400000',
    );
  });
});
