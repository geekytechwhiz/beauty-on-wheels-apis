jest.mock('../events/task-command.publisher', () => ({
  publishCancelReminderJobs: jest.fn().mockResolvedValue(undefined),
  publishRegisterReminderJobs: jest.fn().mockResolvedValue(undefined),
}));

import { publishCancelReminderJobs, publishRegisterReminderJobs } from '../events/task-command.publisher';
import { DuplicateTaskError } from '../errors/duplicate-task.error';
import { TASK_RUNTIME_ACTION } from '../models/types/task-domain.types';
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
import type { TaskLookupDdbRecord, TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { TaskRepository } from '../repositories/task-repository';
import { TaskService } from './task.service';

function basePayload(): CreateMonitoringActionPayload {
  return {
    organizationId: 'org-1',
    patientId: 'pat-1',
    patientDisplayName: 'Test Patient',
    carePlanInstanceId: 'cp-1',
    monitoringInstanceId: 'mon-1',
    taskBehaviorCode: 'METRIC_CHECKIN',
    assignedToType: 'patient',
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

  it('throws 422 when staff assignment is missing staff fields', async () => {
    const svc = new TaskService({} as TaskRepository, {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    await expect(
      svc.createMonitoringAction({
        ...basePayload(),
        assignedToType: 'orgStaff',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('ignores staff fields when assignedToType is patient', async () => {
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
    await svc.createMonitoringAction({
      ...basePayload(),
      assignedToType: 'patient',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(repo.createMonitoringTask).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedToType: 'patient',
      }),
    );
    expect(repo.createMonitoringTask).toHaveBeenCalledWith(
      expect.not.objectContaining({
        assignedToStaffId: expect.anything(),
        assignedToStaffDisplayName: expect.anything(),
      }),
    );
  });

  it('throws 422 when assignedToType is not patient or staff', async () => {
    const svc = new TaskService({} as TaskRepository, {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    await expect(
      svc.createMonitoringAction({
        ...basePayload(),
        assignedToType: 'careTeam' as unknown as CreateMonitoringActionPayload['assignedToType'],
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
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
    patientDisplayName: 'Test Patient',
    runtimeTaskSource: RUNTIME_TASK_SOURCE.MANUAL_SYSTEM,
    taskBehaviorCode: 'CARE_TEAM_TASK',
    taskDisplayGroup: 'staffTask',
    displayTitle: 'Follow up call',
    assignedToType: 'orgStaff',
    assignedToStaffId: 'staff-1',
    assignedToStaffDisplayName: 'Nurse One',
    displayToPatient: false,
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

  it('throws 422 when staff assignment is missing staff fields', async () => {
    const svc = new TaskService({} as TaskRepository, {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    await expect(
      svc.createRuntimeTask({
        ...runtimePayload(),
        assignedToType: 'orgStaff',
        assignedToStaffId: undefined,
        assignedToStaffDisplayName: undefined,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('ignores staff fields when assignedToType is patient', async () => {
    const record = { ...sampleRecord(), runtimeTaskSource: 'manualSystem' as const };
    const repo = {
      createRuntimeTask: jest.fn().mockResolvedValue(record),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    await svc.createRuntimeTask({
      ...runtimePayload(),
      assignedToType: 'patient',
      displayToPatient: true,
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(repo.createRuntimeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedToType: 'patient',
      }),
    );
    expect(repo.createRuntimeTask).toHaveBeenCalledWith(
      expect.not.objectContaining({
        assignedToStaffId: expect.anything(),
        assignedToStaffDisplayName: expect.anything(),
      }),
    );
  });
});

function sampleLookup(overrides: Partial<TaskLookupDdbRecord> = {}): TaskLookupDdbRecord {
  return {
    pk: 'TASK#rtask-abc',
    sk: 'LOOKUP',
    entityType: 'TaskLookup',
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    taskSk: 'DUE#1780581600000#TASK#rtask-abc',
    dueWindowStart: 1780581600000,
    dueWindowEnd: 1780668000000,
    reminderHistory: [],
    ...overrides,
  };
}

describe('TaskService.getRuntimeTaskDetail', () => {
  it('returns task detail with related data by default', async () => {
    const record = sampleRecord();
    const lookup = sampleLookup({
      reminderHistory: [{ reminderRecordId: 'rem-1' }],
      evidenceSummary: {
        runtimeTaskInstanceId: 'rtask-abc',
        generatedAt: 1780581700000,
        latestCompletionSummary: 'Submitted',
      },
    });
    const evidence = [
      {
        pk: 'TASK#rtask-abc',
        sk: 'EVID#evt-1',
        completionEvidenceId: 'evt-1',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        completionSource: 'LinkedObject',
        completedAt: 1780581800000,
      },
    ];
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(lookup),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
      queryCompletionEvidence: jest.fn().mockResolvedValue(evidence),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.getRuntimeTaskDetail({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
    });

    expect(result.task.runtimeTaskInstanceId).toBe('rtask-abc');
    expect(result.reminders).toEqual([{ reminderRecordId: 'rem-1' }]);
    expect(result.evidenceSummary).toMatchObject({ latestCompletionSummary: 'Submitted' });
    expect(result.completionEvidence).toEqual(evidence);
    expect(repo.queryCompletionEvidence).toHaveBeenCalledWith('rtask-abc');
  });

  it('omits related data when includeRelated is false', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup()),
      getMetaByLookup: jest.fn().mockResolvedValue(sampleRecord()),
      queryCompletionEvidence: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.getRuntimeTaskDetail({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      includeRelated: false,
    });

    expect(result.task.runtimeTaskInstanceId).toBe('rtask-abc');
    expect(result).not.toHaveProperty('reminders');
    expect(result).not.toHaveProperty('completionEvidence');
    expect(repo.queryCompletionEvidence).not.toHaveBeenCalled();
  });

  it('throws 404 when lookup is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.getRuntimeTaskDetail({ organizationId: 'org-1', runtimeTaskInstanceId: 'rtask-missing' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'TASK_NOT_FOUND' });
  });

  it('throws 403 when lookup belongs to another org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup({ orgId: 'org-2' })),
      getMetaByLookup: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.getRuntimeTaskDetail({ organizationId: 'org-1', runtimeTaskInstanceId: 'rtask-abc' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(repo.getMetaByLookup).not.toHaveBeenCalled();
  });
});

function carePlanBatchPayload(): GenerateCarePlanTasksRequest {
  return {
    organizationId: 'org-1',
    createdBy: 'system:care-plan-runtime',
    patientId: 'pat-1',
    patientDisplayName: 'Test Patient',
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

function sampleHistEntry() {
  return {
    pk: 'TASK#rtask-abc',
    sk: 'HIST#1780581600000#hist-1',
    entityType: 'TaskStateHistory' as const,
    taskStateHistoryId: 'hist-1',
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    historyEventType: 'stateChange' as const,
    toState: 'active' as const,
    transitionAt: 1780581600000,
    transitionBy: 'system:monitoring-runtime',
    transitionSource: 'system' as const,
    transitionReason: 'monitoringRuntime create',
  };
}

describe('TaskService.getRuntimeTaskHistory', () => {
  it('returns paged history entries newest-first', async () => {
    const hist = sampleHistEntry();
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup()),
      queryTaskHistoryPage: jest.fn().mockResolvedValue({
        items: [hist],
        lastEvaluatedKey: { pk: 'TASK#rtask-abc', sk: 'HIST#1780581500000#hist-0' },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.getRuntimeTaskHistory({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      pageSize: 50,
    });

    expect(result.items).toEqual([
      {
        taskStateHistoryId: 'hist-1',
        historyEventType: 'stateChange',
        toState: 'active',
        transitionAt: 1780581600000,
        transitionBy: 'system:monitoring-runtime',
        transitionSource: 'system',
        transitionReason: 'monitoringRuntime create',
      },
    ]);
    expect(result.nextToken).toBeTruthy();
    expect(repo.queryTaskHistoryPage).toHaveBeenCalledWith('rtask-abc', 50, undefined);
  });

  it('passes decoded nextToken cursor to repository', async () => {
    const cursor = Buffer.from(JSON.stringify({ pk: 'TASK#rtask-abc', sk: 'HIST#x' }), 'utf8').toString(
      'base64url',
    );
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup()),
      queryTaskHistoryPage: jest.fn().mockResolvedValue({ items: [] }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    await svc.getRuntimeTaskHistory({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      pageSize: 10,
      nextToken: cursor,
    });

    expect(repo.queryTaskHistoryPage).toHaveBeenCalledWith('rtask-abc', 10, {
      pk: 'TASK#rtask-abc',
      sk: 'HIST#x',
    });
  });

  it('throws 404 when lookup is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.getRuntimeTaskHistory({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-missing',
        pageSize: 50,
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'TASK_NOT_FOUND' });
  });

  it('throws 403 when lookup belongs to another org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup({ orgId: 'org-2' })),
      queryTaskHistoryPage: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.getRuntimeTaskHistory({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        pageSize: 50,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(repo.queryTaskHistoryPage).not.toHaveBeenCalled();
  });
});

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

  it('throws 422 when staff linkage is missing staff fields', async () => {
    const repo = {} as unknown as TaskRepository;
    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.generateCarePlanTasks({
        ...carePlanBatchPayload(),
        linkages: [
          {
            ...carePlanBatchPayload().linkages[0],
            assignedToType: 'orgStaff',
            displayToPatient: false,
          },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
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
    patientDisplayName: 'Maria Lopez',
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

function staffTaskRecord(overrides: Partial<TaskMetaDdbRecord> = {}): TaskMetaDdbRecord {
  return {
    ...sampleRecord(),
    taskBehaviorCode: 'CARE_TEAM_TASK',
    taskDisplayGroup: 'staffTask',
    assignedToType: 'orgStaff',
    assignedToStaffId: 'staff-1',
    displayToPatient: false,
    gsi1pk: 'ORG#org-1#STAFF#staff-1',
    ...overrides,
  };
}

describe('TaskService.reassignAssignedStaff', () => {
  it('reassigns staff and returns task with history entry', async () => {
    const meta = staffTaskRecord();
    const lookup = sampleLookup({ assignedToStaffId: 'staff-1' });
    const updatedMeta = staffTaskRecord({
      assignedToStaffId: 'staff-2',
      gsi1pk: 'ORG#org-1#STAFF#staff-2',
      lastUpdatedBy: 'staff-manager-1',
    });
    const historyEntry = {
      pk: 'TASK#rtask-abc',
      sk: 'HIST#1780581700000#hist-reassign',
      entityType: 'TaskStateHistory' as const,
      taskStateHistoryId: 'hist-reassign',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      historyEventType: 'assignedToStaffChange' as const,
      transitionAt: 1780581700000,
      transitionBy: 'staff-manager-1',
      transitionSource: 'manual' as const,
      transitionReason: 'Shift handoff',
      previousAssignedToStaffId: 'staff-1',
      newAssignedToStaffId: 'staff-2',
    };

    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(lookup),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      reassignStaffTask: jest.fn().mockResolvedValue({ record: updatedMeta, historyEntry }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.reassignAssignedStaff({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-manager-1',
      assignedToStaffId: 'staff-2',
      assignedToStaffDisplayName: 'Nurse Two',
      reason: 'Shift handoff',
    });

    expect(result.runtimeTaskInstanceId).toBe('rtask-abc');
    expect(result.task.assignedToStaffId).toBe('staff-2');
    expect(result.historyEntry).toMatchObject({
      historyEventType: 'assignedToStaffChange',
      previousAssignedToStaffId: 'staff-1',
      newAssignedToStaffId: 'staff-2',
      transitionReason: 'Shift handoff',
    });
    expect(repo.reassignStaffTask).toHaveBeenCalledWith({
      meta,
      lookup,
      actorId: 'staff-manager-1',
      assignedToStaffId: 'staff-2',
      assignedToStaffDisplayName: 'Nurse Two',
      reason: 'Shift handoff',
    });
  });

  it('throws 422 when task is not a staff task', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup()),
      getMetaByLookup: jest.fn().mockResolvedValue(sampleRecord({ assignedToType: 'patient' })),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.reassignAssignedStaff({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        assignedToStaffId: 'staff-2',
        assignedToStaffDisplayName: 'Nurse Two',
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'NOT_STAFF_TASK' });
  });

  it('assigns staff when task has no prior assignedToStaffId', async () => {
    const meta = staffTaskRecord({ assignedToStaffId: undefined, gsi1pk: undefined, gsi1sk: undefined });
    const lookup = sampleLookup();
    const updatedMeta = staffTaskRecord({
      assignedToStaffId: 'staff-2',
      gsi1pk: 'ORG#org-1#STAFF#staff-2',
      gsi1sk: 'DUE#1780581600000#PAT#pat-1#TASK#rtask-abc',
    });
    const historyEntry = {
      pk: 'TASK#rtask-abc',
      sk: 'HIST#1780581700000#hist-assign',
      entityType: 'TaskStateHistory' as const,
      taskStateHistoryId: 'hist-assign',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      historyEventType: 'assignedToStaffChange' as const,
      transitionAt: 1780581700000,
      transitionBy: 'staff-manager-1',
      transitionSource: 'manual' as const,
      newAssignedToStaffId: 'staff-2',
    };

    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(lookup),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      reassignStaffTask: jest.fn().mockResolvedValue({ record: updatedMeta, historyEntry }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.reassignAssignedStaff({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-manager-1',
      assignedToStaffId: 'staff-2',
      assignedToStaffDisplayName: 'Nurse Two',
    });

    expect(result.task.assignedToStaffId).toBe('staff-2');
    expect(result.historyEntry).toMatchObject({
      historyEventType: 'assignedToStaffChange',
      newAssignedToStaffId: 'staff-2',
    });
    expect(result.historyEntry).not.toHaveProperty('previousAssignedToStaffId');
    expect(repo.reassignStaffTask).toHaveBeenCalled();
  });

  it('throws 422 when staff is already assigned', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup({ assignedToStaffId: 'staff-1' })),
      getMetaByLookup: jest.fn().mockResolvedValue(staffTaskRecord()),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.reassignAssignedStaff({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        assignedToStaffId: 'staff-1',
        assignedToStaffDisplayName: 'Nurse One',
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'STAFF_ALREADY_ASSIGNED' });
  });
});

describe('TaskService.updateTaskState', () => {
  beforeEach(() => {
    jest.mocked(publishCancelReminderJobs).mockClear();
  });

  it('completes task without publishing cancel reminder jobs while scheduler is disabled', async () => {
    const meta = sampleRecord({ currentState: 'open' });
    const lookup = sampleLookup({
      reminderHistory: [{ reminderRecordId: 'rem-1', reminderStatus: 'scheduled' }],
    });
    const historyEntry = {
      pk: 'TASK#rtask-abc',
      sk: 'HIST#1780573500000#hist-1',
      entityType: 'TaskStateHistory' as const,
      taskStateHistoryId: 'hist-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      historyEventType: 'stateChange' as const,
      fromState: 'open' as const,
      toState: 'completed' as const,
      transitionAt: 1780573500000,
      transitionBy: 'pat-1',
      transitionSource: 'manual' as const,
    };

    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(lookup),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      transitionTaskState: jest.fn().mockResolvedValue({
        record: { ...meta, currentState: 'completed' },
        historyEntry,
        hadCancellableReminders: true,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.updateTaskState({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      action: TASK_RUNTIME_ACTION.COMPLETE,
      actorId: 'pat-1',
      actorType: 'patient',
      expectedCurrentState: 'open',
      reason: 'Done',
    });

    expect(result.currentState).toBe('completed');
    expect(result.historyEntry).toMatchObject({ historyEventType: 'stateChange' });
    expect(publishCancelReminderJobs).not.toHaveBeenCalled();
  });
});

describe('TaskService.updateReminderSettings', () => {
  beforeEach(() => {
    jest.mocked(publishCancelReminderJobs).mockClear();
    jest.mocked(publishRegisterReminderJobs).mockClear();
  });

  it('enables reminders without publishing register jobs while scheduler is disabled', async () => {
    const meta = { ...sampleRecord(), reminderEnabled: false, currentState: 'open' as const };
    const lookup = sampleLookup();
    const settingsChangeHist = {
      pk: 'TASK#rtask-abc',
      sk: 'HIST#1780573500000#hist-rem-1',
      entityType: 'TaskStateHistory' as const,
      taskStateHistoryId: 'hist-rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      historyEventType: 'reminderSettingsChange' as const,
      transitionAt: 1780573500000,
      transitionBy: 'staff-1',
      transitionSource: 'manual' as const,
      newReminderEnabled: true,
      newReminderSettings: { channels: ['push'] },
    };

    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(lookup),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      updateReminderSettings: jest.fn().mockResolvedValue({
        record: { ...meta, reminderEnabled: true, reminderSettings: { channels: ['push'] } },
        settingsChangeHist,
        registerRequestHist: {
          historyEventType: 'reminderRegisterRequest',
        },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.updateReminderSettings({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-1',
      reminderEnabled: true,
      reminderSettings: { channels: ['push'] },
      reason: 'Patient requested',
    });

    expect(result.reminderEnabled).toBe(true);
    expect(result.historyEntry).toMatchObject({ historyEventType: 'reminderSettingsChange' });
    expect(publishRegisterReminderJobs).not.toHaveBeenCalled();
    expect(publishCancelReminderJobs).not.toHaveBeenCalled();
  });

  it('rejects unchanged settings with 422', async () => {
    const meta = {
      ...sampleRecord(),
      reminderEnabled: true,
      reminderSettings: { channels: ['push'] },
    };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup()),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      updateReminderSettings: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    await expect(
      svc.updateReminderSettings({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reminderEnabled: true,
        reminderSettings: { channels: ['push'] },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'REMINDER_SETTINGS_UNCHANGED' });
    expect(repo.updateReminderSettings).not.toHaveBeenCalled();
  });

  it('rejects enable on terminal task with 422', async () => {
    const meta = {
      ...sampleRecord(),
      currentState: 'completed' as const,
      reminderEnabled: false,
    };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(sampleLookup()),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      updateReminderSettings: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    await expect(
      svc.updateReminderSettings({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reminderEnabled: true,
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'REMINDER_NOT_ELIGIBLE' });
  });
});

describe('TaskService.getTaskStatusSummaryByCarePlan', () => {
  it('aggregates all care plan task pages into a readiness summary', async () => {
    const requiredDone = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 't-done',
      currentState: 'completed' as const,
      requiredForStageCompletion: true,
    };
    const requiredOpen = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 't-open',
      currentState: 'open' as const,
      requiredForStageCompletion: true,
      displayTitle: 'Still open',
    };

    const repo = {
      queryCarePlanTasksForSummaryPage: jest
        .fn()
        .mockResolvedValueOnce({ items: [requiredDone], lastEvaluatedKey: { pk: 'next' } })
        .mockResolvedValueOnce({ items: [requiredOpen], lastEvaluatedKey: undefined }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.getTaskStatusSummaryByCarePlan({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
    });

    expect(repo.queryCarePlanTasksForSummaryPage).toHaveBeenCalledTimes(2);
    expect(result.readinessStatus).toBe('notReady');
    expect(result.counts.requiredTotal).toBe(2);
    expect(result.incompleteRequiredTasks).toHaveLength(1);
    expect(result.incompleteRequiredTasks?.[0].runtimeTaskInstanceId).toBe('t-open');
  });
});

describe('TaskService.listPatientTasks', () => {
  it('splits patient and staff buckets and normalizes legacy active state to open', async () => {
    const patientTask = sampleRecord();
    const staffTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-staff',
      sk: 'DUE#1780668000000#TASK#rtask-staff',
      assignedToType: 'orgStaff' as const,
      assignedToStaffId: 'staff-1',
      displayToPatient: false,
    };

    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [staffTask, patientTask],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listPatientTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      staffUserId: 'staff-1',
      pageSize: 50,
    });

    expect(repo.queryPatientTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTerminalStates: true,
        pageSize: 50,
      }),
    );
    expect(result.patientId).toBe('pat-1');
    expect(result.staffUserId).toBe('staff-1');
    expect(result.patientTasks.items).toHaveLength(1);
    expect(result.patientTasks.items[0].runtimeTaskInstanceId).toBe('rtask-abc');
    expect(result.patientTasks.items[0].currentState).toBe('open');
    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].runtimeTaskInstanceId).toBe('rtask-staff');
    expect(result.nextToken).toBeUndefined();
  });

  it('returns empty staffTasks when staffUserId is omitted', async () => {
    const staffTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-staff',
      assignedToType: 'orgStaff' as const,
      assignedToStaffId: 'staff-1',
    };

    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [staffTask],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listPatientTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 50,
    });

    expect(result.patientTasks.items).toHaveLength(0);
    expect(result.staffTasks.items).toHaveLength(0);
    expect(result.staffUserId).toBeUndefined();
  });
});

describe('TaskService.listActionCenterItems', () => {
  const NOW = Date.parse('2026-06-05T12:00:00.000Z');

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('groups items into sections when surfaceSection is all', async () => {
    const todayTask = sampleRecord();
    const historyTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-done',
      sk: 'DUE#1780200000000#TASK#rtask-done',
      currentState: 'completed' as const,
      dueWindowStart: 1780200000000,
      dueWindowEnd: 1780250000000,
    };
    const checklistTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-checklist',
      sk: 'DUE#1780581600000#TASK#rtask-checklist',
      displayAsChecklistItem: true,
    };

    const repo = {
      queryActionCenterTasksPage: jest.fn().mockResolvedValue({
        items: [todayTask, historyTask, checklistTask],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      surfaceSection: 'all',
      timezone: 'UTC',
      pageSize: 50,
    });

    expect(repo.queryActionCenterTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', patientId: 'pat-1', pageSize: 50 }),
    );
    expect(result.patientId).toBe('pat-1');
    expect(result.timezone).toBe('UTC');
    if ('sections' in result) {
      expect(result.sections.today).toHaveLength(2);
      expect(result.sections.today.every((c) => c.surfaceSection === 'today')).toBe(true);
      expect(result.sections.history).toHaveLength(1);
      expect(result.sections.history[0].surfaceSection).toBe('history');
      expect(result.sections.carePlanChecklist).toHaveLength(1);
      expect(result.sections.carePlanChecklist[0].runtimeTaskInstanceId).toBe('rtask-checklist');
      expect(result.sections.carePlanChecklist[0].surfaceSection).toBe('carePlanChecklist');
    } else {
      throw new Error('expected grouped sections');
    }
  });

  it('filters single section with over-fetch rounds', async () => {
    const upcomingTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-upcoming',
      sk: 'DUE#1780800000000#TASK#rtask-upcoming',
      dueWindowStart: 1780800000000,
      dueWindowEnd: 1780886400000,
    };
    const todayTask = sampleRecord();

    const repo = {
      queryActionCenterTasksPage: jest
        .fn()
        .mockResolvedValueOnce({ items: [todayTask], lastEvaluatedKey: { pk: 'next' } })
        .mockResolvedValueOnce({ items: [upcomingTask], lastEvaluatedKey: undefined }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      surfaceSection: 'upcoming',
      timezone: 'UTC',
      pageSize: 1,
    });

    expect(repo.queryActionCenterTasksPage).toHaveBeenCalledTimes(2);
    if ('items' in result) {
      expect(result.surfaceSection).toBe('upcoming');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].runtimeTaskInstanceId).toBe('rtask-upcoming');
      expect(result.items[0].surfaceSection).toBe('upcoming');
    } else {
      throw new Error('expected single-section items');
    }
  });
});

describe('TaskService.listStaffTasks', () => {
  it('queries staff inbox and maps cards sorted by dueWindowStart', async () => {
    const early = sampleRecord();
    const late = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-late',
      dueWindowStart: 1780668000000,
    };

    const repo = {
      queryStaffTasksPage: jest.fn().mockResolvedValue({
        items: [late, early],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listStaffTasks({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      pageSize: 25,
    });

    expect(repo.queryStaffTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({
        staffUserId: 'staff-1',
        excludeTerminalStates: true,
        pageSize: 25,
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0].runtimeTaskInstanceId).toBe('rtask-abc');
    expect(result.items[0].currentState).toBe('open');
  });
});

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
