import { DuplicateTaskError } from '../errors/duplicate-task.error';
import { TASK_RUNTIME_ACTION } from '../models/types/task-domain.types';
import type { CreateMonitoringActionPayload } from '../models/api/create-monitoring-action.types';
import type { CreateRuntimeTaskHttpBody, CreateRuntimeTaskPayload } from '../models/api/create-runtime-task.types';
import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import type {
  CarePlanTaskGenerationIngressInput,
  RuntimeTaskHttpIngressInput,
} from '../models/api/task-event-ingest.types';
import { buildCarePlanTaskIdempotencyKey, buildCarePlanTaskKeys } from '../utils/monitoring-idempotency';
import { nowEpochMs } from '../utils/task-time';
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
  const now = Date.now();
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
    currentState: 'scheduled',
    dueWindowStart: now,
    dueWindowEnd: now + 24 * 60 * 60 * 1000,
    createdAt: now,
    createdBy: 'system:monitoring-runtime',
    lastUpdatedAt: now,
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

function runtimeIngressPayload(
  bodyOverrides: Partial<CreateRuntimeTaskHttpBody> = {},
): RuntimeTaskHttpIngressInput {
  return {
    kind: 'http',
    organizationId: 'org-1',
    createdBy: 'user:staff-1',
    body: {
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
      ...bodyOverrides,
    },
  };
}

function runtimeRepoPayload(): CreateRuntimeTaskPayload {
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
    const result = await svc.createRuntimeTask(runtimeIngressPayload());

    expect(result).toEqual({ record });
    expect(repo.createRuntimeTask).toHaveBeenCalledWith(runtimeRepoPayload());
  });

  it('propagates repository errors', async () => {
    const repo = {
      createRuntimeTask: jest.fn().mockRejectedValue(new Error('ddb failure')),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(svc.createRuntimeTask(runtimeIngressPayload())).rejects.toThrow('ddb failure');
  });

  it('throws 422 when staff assignment is missing staff fields', async () => {
    const svc = new TaskService({} as TaskRepository, {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    await expect(
      svc.createRuntimeTask(
        runtimeIngressPayload({
          assignedToType: 'orgStaff',
          assignedToStaffId: undefined,
          assignedToStaffDisplayName: undefined,
        }),
      ),
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
    await svc.createRuntimeTask(
      runtimeIngressPayload({
        assignedToType: 'patient',
        displayToPatient: true,
        assignedToStaffId: 'staff-nurse-44721',
        assignedToStaffDisplayName: 'Nurse Patel',
      }),
    );

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

function carePlanBatchPayload(): CarePlanTaskGenerationIngressInput {
  return {
    organizationId: 'org-1',
    patientId: 'pat-1',
    patientDisplayName: 'Test Patient',
    carePlanInstanceId: 'cp-1',
    taskGenerationTrigger: 'carePlanStageEntered',
    sourceLinkageContext: {
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
    },
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
        sourceLinkageContext: {
          linkages: [
            {
              ...carePlanBatchPayload().sourceLinkageContext.linkages[0],
              assignedToType: 'orgStaff',
              displayToPatient: false,
            },
          ],
        },
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
  it('completes task and returns state change history', async () => {
    const meta = sampleRecord({ currentState: 'scheduled' });
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
      fromState: 'scheduled' as const,
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
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.updateTaskState({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      action: TASK_RUNTIME_ACTION.COMPLETE,
      actorId: 'pat-1',
      actorType: 'patient',
      expectedCurrentState: 'active',
      reason: 'Done',
    });

    expect(result.currentState).toBe('completed');
    expect(result.historyEntry).toMatchObject({ historyEventType: 'stateChange' });
  });
});

describe('TaskService.updateReminderSettings', () => {
  it('enables reminders and returns settings change history', async () => {
    const meta = { ...sampleRecord(), reminderEnabled: false, currentState: 'scheduled' as const };
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

describe('TaskService.updateRuntimeTask', () => {
  it('updates metadata and returns task card with history', async () => {
    const meta = { ...sampleRecord(), displayTitle: 'Old title', currentState: 'scheduled' as const };
    const lookup = {
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP' as const,
      entityType: 'TaskLookup' as const,
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: meta.sk,
    };

    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(lookup),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      updateRuntimeTask: jest.fn().mockResolvedValue({
        record: { ...meta, displayTitle: 'New title' },
        historyEntry: {
          historyEventType: 'taskMetadataChange',
          changedFields: ['displayTitle'],
        },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.updateRuntimeTask({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-1',
      patch: { displayTitle: 'New title' },
    });

    expect(result.task.displayTitle).toBe('New title');
    expect(result.historyEntry).toMatchObject({ historyEventType: 'taskMetadataChange' });
  });

  it('rejects unchanged metadata', async () => {
    const meta = { ...sampleRecord(), displayTitle: 'Same', currentState: 'scheduled' as const };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        taskSk: meta.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
      updateRuntimeTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    await expect(
      svc.updateRuntimeTask({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        patch: { displayTitle: 'Same' },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'TASK_METADATA_UNCHANGED' });
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
      currentState: 'scheduled' as const,
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
      pageSize: 50,
    });

    expect(repo.queryPatientTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTerminalStates: true,
        pageSize: 50,
      }),
    );
    expect(result.patientId).toBe('pat-1');
    expect(result.patientTasks.items).toHaveLength(1);
    expect(result.patientTasks.items[0].runtimeTaskInstanceId).toBe('rtask-abc');
    expect(result.patientTasks.items[0].currentState).toBe('active');
    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].runtimeTaskInstanceId).toBe('rtask-staff');
    expect(result.nextToken).toBeUndefined();
  });

  it('always returns all patient tasks even when staffUserId filters staff bucket', async () => {
    const patientTask = sampleRecord();
    const matchingStaffTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-staff',
      assignedToType: 'orgStaff' as const,
      assignedToStaffId: 'staff-1',
    };
    const otherStaffTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-other',
      assignedToType: 'orgStaff' as const,
      assignedToStaffId: 'staff-2',
    };

    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [patientTask, matchingStaffTask, otherStaffTask],
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

    expect(result.patientTasks.items).toHaveLength(1);
    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].runtimeTaskInstanceId).toBe('rtask-staff');
  });

  it('filters staffTasks to matching assignee when staffUserId is provided', async () => {
    const careTeamTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-role',
      assignedToType: 'careTeamRole' as const,
      assignedToStaffId: 'role-1',
      assignedToStaffDisplayName: 'Triage Nurse',
      displayToPatient: false,
    };

    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [careTeamTask],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listPatientTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      staffUserId: 'role-1',
      pageSize: 50,
    });

    expect(result.staffUserId).toBe('role-1');
    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].assignedToType).toBe('careTeamRole');
  });

  it('excludes non-matching staff tasks when staffUserId is provided', async () => {
    const staffTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-staff',
      assignedToType: 'orgStaff' as const,
      assignedToStaffId: 'staff-1',
    };
    const otherStaffTask = {
      ...sampleRecord(),
      runtimeTaskInstanceId: 'rtask-other',
      assignedToType: 'orgStaff' as const,
      assignedToStaffId: 'staff-2',
    };

    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [staffTask, otherStaffTask],
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

    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].runtimeTaskInstanceId).toBe('rtask-staff');
  });

  it('returns staff-assigned tasks in staffTasks without staffUserId filter', async () => {
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
    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].runtimeTaskInstanceId).toBe('rtask-staff');
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
    expect(result.items[0].currentState).toBe('active');
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

describe('TaskService.checkReminderFireEligibility', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  it('returns eligible when reminders are enabled and task is open', async () => {
    const meta = { ...sampleRecord(), currentState: 'scheduled' as const, reminderEnabled: true };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-1', patientId: 'pat-1', taskSk: meta.sk }),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.checkReminderFireEligibility({ runtimeTaskInstanceId: 'rtask-abc' });

    expect(result).toEqual({ status: 'eligible', meta });
  });

  it('returns skipped when reminders are disabled', async () => {
    const meta = { ...sampleRecord(), reminderEnabled: false };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-1' }),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.checkReminderFireEligibility({ runtimeTaskInstanceId: 'rtask-abc' });

    expect(result).toEqual({ status: 'skipped', reason: 'remindersDisabled' });
  });

  it('returns skipped when task is terminal', async () => {
    const meta = { ...sampleRecord(), currentState: 'completed' as const, reminderEnabled: true };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-1' }),
      getMetaByLookup: jest.fn().mockResolvedValue(meta),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.checkReminderFireEligibility({ runtimeTaskInstanceId: 'rtask-abc' });

    expect(result).toEqual({ status: 'skipped', reason: 'taskTerminalState:completed' });
  });

  it('throws 404 when lookup or meta is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue(null),
      getMetaByLookup: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(
      svc.checkReminderFireEligibility({ runtimeTaskInstanceId: 'rtask-missing' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'TASK_NOT_FOUND' });
  });
});

describe('TaskService reminder record passthrough', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  it('delegates registration, cancellation, and outcome to repository', async () => {
    const repo = {
      recordReminderRegistered: jest.fn().mockResolvedValue({ written: true }),
      recordReminderCancelled: jest.fn().mockResolvedValue({ written: true }),
      recordReminderOutcome: jest.fn().mockResolvedValue({ written: true }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);

    await svc.recordReminderRegistration({
      runtimeTaskInstanceId: 'rtask-abc',
      scheduledAt: 1,
      channel: 'push',
      schedulerJobId: 'job-1',
    });
    await svc.recordReminderCancellation({ runtimeTaskInstanceId: 'rtask-abc', reason: 'disabled' });
    await svc.recordReminderOutcome({ runtimeTaskInstanceId: 'rtask-abc', outcome: 'sent' });

    expect(repo.recordReminderRegistered).toHaveBeenCalled();
    expect(repo.recordReminderCancelled).toHaveBeenCalled();
    expect(repo.recordReminderOutcome).toHaveBeenCalled();
  });
});

describe('TaskService.getRuntimeTaskDetail evidenceSummary', () => {
  it('includes evidenceSummary from lookup when present', async () => {
    const record = sampleRecord();
    const evidenceSummary = { completedAt: 1, completedBy: 'pat-1' };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
        evidenceSummary,
        reminderHistory: [],
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
      queryCompletionEvidence: jest.fn().mockResolvedValue([]),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const detail = await svc.getRuntimeTaskDetail({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
    });

    expect(detail.evidenceSummary).toEqual(evidenceSummary);
  });

  it('omits evidenceSummary when lookup has none', async () => {
    const record = sampleRecord();
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
        reminderHistory: [],
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
      queryCompletionEvidence: jest.fn().mockResolvedValue([]),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const detail = await svc.getRuntimeTaskDetail({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
    });

    expect(detail).not.toHaveProperty('evidenceSummary');
    expect(detail.reminders).toEqual([]);
  });
});

describe('TaskService.updateTaskState conditional failure', () => {
  it('throws 409 when repository reports expected-state mismatch', async () => {
    const record = { ...sampleRecord(), currentState: 'scheduled' as const };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
      transitionTaskState: jest.fn().mockRejectedValue({
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);

    await expect(
      svc.updateTaskState({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        action: TASK_RUNTIME_ACTION.COMPLETE,
        expectedCurrentState: 'active',
        actorId: 'pat-1',
        actorType: 'patient',
        reason: 'Done',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'EXPECTED_STATE_MISMATCH' });
  });
});

describe('TaskService.completeLinkedSourceObject', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  it('completes open tasks and skips terminal tasks', async () => {
    const openMeta = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      runtimeTaskInstanceId: 'rtask-open',
    };
    const completedMeta = {
      ...sampleRecord(),
      currentState: 'completed' as const,
      runtimeTaskInstanceId: 'rtask-done',
    };
    const repo = {
      queryPatientMetaByCompletionSource: jest.fn().mockResolvedValue({
        items: [openMeta, completedMeta],
        lastEvaluatedKey: undefined,
      }),
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: openMeta.sk,
      }),
      completeLinkedSourceObjectTask: jest.fn().mockResolvedValue({ outcome: 'completed' }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.completeLinkedSourceObject({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'formSubmission',
      completionSourceReferenceId: 'form-1',
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(result.results).toEqual([
      { runtimeTaskInstanceId: 'rtask-open', outcome: 'completed' },
      { runtimeTaskInstanceId: 'rtask-done', outcome: 'skippedTerminal' },
    ]);
  });

  it('logs warning and skips task when lookup is missing', async () => {
    const openMeta = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      runtimeTaskInstanceId: 'rtask-open',
    };
    const repo = {
      queryPatientMetaByCompletionSource: jest.fn().mockResolvedValue({
        items: [openMeta],
        lastEvaluatedKey: undefined,
      }),
      getLookupByTaskId: jest.fn().mockResolvedValue(null),
      completeLinkedSourceObjectTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.completeLinkedSourceObject({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'formSubmission',
      completionSourceReferenceId: 'form-1',
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(result.results).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
    expect(repo.completeLinkedSourceObjectTask).not.toHaveBeenCalled();
  });
});

describe('TaskService.generateCarePlanTasks idempotency branches', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  it('returns skippedDuplicate after care plan transaction race', async () => {
    const record = sampleRecord();
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest
        .fn()
        .mockResolvedValueOnce('missing')
        .mockResolvedValueOnce(record),
      createCarePlanTask: jest.fn().mockRejectedValue(new DuplicateTaskError('rtask-abc')),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.generateCarePlanTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      patientDisplayName: 'Jane',
      carePlanInstanceId: 'cp-1',
      taskGenerationTrigger: 'carePlanActivated',
      sourceLinkageContext: {
        linkages: [
          {
            carePlanTaskLinkageId: 'link-1',
            taskBehaviorCode: 'METRIC_CHECKIN',
            taskDisplayGroup: 'checkIn',
            displayTitle: 'Check in',
            assignedToType: 'patient',
            displayToPatient: true,
            dueWindowStart: 1780581600000,
            dueWindowEnd: 1780668000000,
          },
        ],
      },
    });

    expect(result.results[0].outcome).toBe('skippedDuplicate');
  });
});

describe('TaskService.getRuntimeTaskDetail missing meta', () => {
  it('throws 404 when meta record is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: 'DUE#1#TASK#rtask-abc',
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    await expect(
      svc.getRuntimeTaskDetail({ organizationId: 'org-1', runtimeTaskInstanceId: 'rtask-abc' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('TaskService.listPatientTasks pagination and staff bucket', () => {
  it('decodes nextToken and returns all non-patient tasks when staffUserId is omitted', async () => {
    const cursor = Buffer.from(JSON.stringify({ pk: 'ORG#org-1#PAT#pat-1' }), 'utf8').toString('base64url');
    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [
          {
            ...sampleRecord(),
            assignedToType: 'patient',
            runtimeTaskInstanceId: 'rtask-patient',
          },
          {
            ...sampleRecord(),
            assignedToType: 'orgStaff',
            assignedToStaffId: 'staff-1',
            runtimeTaskInstanceId: 'rtask-staff',
          },
          {
            ...sampleRecord(),
            assignedToType: 'orgStaff',
            assignedToStaffId: 'staff-other',
            runtimeTaskInstanceId: 'rtask-other',
          },
        ],
        lastEvaluatedKey: { pk: 'next' },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listPatientTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 10,
      nextToken: cursor,
    });

    expect(repo.queryPatientTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({ exclusiveStartKey: { pk: 'ORG#org-1#PAT#pat-1' } }),
    );
    expect(result.staffTasks.items).toHaveLength(2);
    expect(result.staffTasks.items.map((t) => t.runtimeTaskInstanceId).sort()).toEqual([
      'rtask-other',
      'rtask-staff',
    ]);
    expect(result.nextToken).toBeDefined();
  });

  it('filters staff bucket when staffUserId is provided', async () => {
    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({
        items: [
          {
            ...sampleRecord(),
            assignedToType: 'orgStaff',
            assignedToStaffId: 'staff-1',
            runtimeTaskInstanceId: 'rtask-staff',
          },
          {
            ...sampleRecord(),
            assignedToType: 'orgStaff',
            assignedToStaffId: 'staff-other',
            runtimeTaskInstanceId: 'rtask-other',
          },
        ],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.listPatientTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      staffUserId: 'staff-1',
      pageSize: 10,
    });

    expect(result.staffTasks.items).toHaveLength(1);
    expect(result.staffTasks.items[0].runtimeTaskInstanceId).toBe('rtask-staff');
  });
});

describe('TaskService.updateReminderSettings response shape', () => {
  it('omits reminderSettings from response when record has none', async () => {
    const record = { ...sampleRecord(), reminderEnabled: false, currentState: 'scheduled' as const };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue({ ...record, reminderEnabled: true }),
      updateReminderSettings: jest.fn().mockResolvedValue({
        record: { ...record, reminderEnabled: false },
        settingsChangeHist: {
          pk: 'TASK#rtask-abc',
          sk: 'HIST#1',
          entityType: 'TaskHistory',
          historyEventType: 'reminderSettingsChange',
          runtimeTaskInstanceId: 'rtask-abc',
          orgId: 'org-1',
          patientId: 'pat-1',
          actorId: 'staff-1',
          createdAt: 1,
        },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.updateReminderSettings({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-1',
      reminderEnabled: false,
      reason: 'Opt out',
    });

    expect(result.reminderEnabled).toBe(false);
    expect(result).not.toHaveProperty('reminderSettings');
  });

  it('includes reminderSettings in response when record has settings', async () => {
    const record = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      reminderEnabled: true,
      reminderSettings: { channels: ['push'] },
    };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue({
        ...record,
        reminderEnabled: false,
        reminderSettings: { channels: ['push'] },
      }),
      updateReminderSettings: jest.fn().mockResolvedValue({
        record: {
          ...record,
          reminderEnabled: true,
          reminderSettings: { channels: ['push', 'email'] },
        },
        settingsChangeHist: {
          pk: 'TASK#rtask-abc',
          sk: 'HIST#1',
          entityType: 'TaskHistory',
          historyEventType: 'reminderSettingsChange',
          runtimeTaskInstanceId: 'rtask-abc',
          orgId: 'org-1',
          patientId: 'pat-1',
          actorId: 'staff-1',
          createdAt: 1,
        },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.updateReminderSettings({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-1',
      reminderEnabled: true,
      reminderSettings: { channels: ['push', 'email'] },
      reason: 'Add email',
    });

    expect(result.reminderSettings).toEqual({ channels: ['push', 'email'] });
  });
});

describe('TaskService.completeLinkedSourceObject skippedDuplicate', () => {
  it('maps skippedDuplicate repository outcome', async () => {
    const openMeta = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      runtimeTaskInstanceId: 'rtask-open',
    };
    const repo = {
      queryPatientMetaByCompletionSource: jest.fn().mockResolvedValue({
        items: [openMeta],
        lastEvaluatedKey: undefined,
      }),
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: openMeta.sk,
      }),
      completeLinkedSourceObjectTask: jest.fn().mockResolvedValue({ outcome: 'skippedDuplicate' }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
    const result = await svc.completeLinkedSourceObject({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'formSubmission',
      completionSourceReferenceId: 'form-1',
      completionEventId: 'evt-dup',
      completedAt: 1780700000000,
    });

    expect(result.results[0].outcome).toBe('skippedDuplicate');
  });
});

describe('TaskService authorization and error paths', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  it('reassignAssignedStaff throws 404 when lookup is missing', async () => {
    const repo = { getLookupByTaskId: jest.fn().mockResolvedValue(null) } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.reassignAssignedStaff({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'admin-1',
        assignedToStaffId: 'staff-2',
        assignedToStaffDisplayName: 'Nurse',
        reason: 'Coverage',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateRuntimeTask throws 403 for foreign org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-other', patientId: 'pat-1', taskSk: 'sk' }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.updateRuntimeTask({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reason: 'Edit',
        patch: { displayTitle: 'New' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('updateReminderSettings throws 404 when meta is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-1', patientId: 'pat-1', taskSk: 'sk' }),
      getMetaByLookup: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.updateReminderSettings({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reminderEnabled: false,
        reason: 'Opt out',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateTaskState rethrows non-http workflow errors', async () => {
    const record = { ...sampleRecord(), currentState: 'scheduled' as const };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.updateTaskState({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        action: TASK_RUNTIME_ACTION.COMPLETE,
        expectedCurrentState: 'completed',
        actorId: 'pat-1',
        actorType: 'patient',
        reason: 'Done',
      }),
    ).rejects.toThrow();
  });

  it('createMonitoringAction logs info on idempotent replay', async () => {
    const record = sampleRecord();
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue(record),
      createMonitoringTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await svc.createMonitoringAction(basePayload());

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'task_monitoring_idempotent_replay' }),
    );
  });

  it('generateCarePlanTasks throws 409 when natural key belongs to foreign org', async () => {
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest.fn().mockResolvedValue('foreign_org'),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(
      svc.generateCarePlanTasks({
        organizationId: 'org-1',
        patientId: 'pat-1',
        patientDisplayName: 'Jane',
        carePlanInstanceId: 'cp-1',
        taskGenerationTrigger: 'carePlanActivated',
        sourceLinkageContext: {
          linkages: [
            {
              carePlanTaskLinkageId: 'link-1',
              taskBehaviorCode: 'METRIC_CHECKIN',
              taskDisplayGroup: 'checkIn',
              displayTitle: 'Check in',
              assignedToType: 'patient',
              displayToPatient: true,
              dueWindowStart: 1780581600000,
              dueWindowEnd: 1780668000000,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_IN_USE' });
  });
});

describe('TaskService query round-cap warnings', () => {
  it('warns when action center surface filter hits max rounds', async () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    const repo = {
      queryActionCenterTasksPage: jest.fn().mockResolvedValue({
        items: [],
        lastEvaluatedKey: { pk: 'next' },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      surfaceSection: 'today',
      pageSize: 50,
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'action_center_surface_filter_round_cap' }),
    );
  });

  it('warns when care plan status summary hits max query rounds', async () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    const repo = {
      queryCarePlanTasksForSummaryPage: jest.fn().mockResolvedValue({
        items: [],
        lastEvaluatedKey: { pk: 'next' },
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await svc.getTaskStatusSummaryByCarePlan({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'task_status_summary_query_round_cap' }),
    );
  });
});

describe('TaskService additional branch coverage', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  it('getRuntimeTaskDetail throws 403 for foreign org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-other', patientId: 'pat-1', taskSk: 'sk' }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.getRuntimeTaskDetail({ organizationId: 'org-1', runtimeTaskInstanceId: 'rtask-abc' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('reassignAssignedStaff throws 403 for foreign org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-other', patientId: 'pat-1', taskSk: 'sk' }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.reassignAssignedStaff({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'admin-1',
        assignedToStaffId: 'staff-2',
        assignedToStaffDisplayName: 'Nurse',
        reason: 'Coverage',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('reassignAssignedStaff throws 404 when meta is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-1', patientId: 'pat-1', taskSk: 'sk' }),
      getMetaByLookup: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.reassignAssignedStaff({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'admin-1',
        assignedToStaffId: 'staff-2',
        assignedToStaffDisplayName: 'Nurse',
        reason: 'Coverage',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('createMonitoringAction rethrows when duplicate race cannot resolve', async () => {
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue('missing'),
      createMonitoringTask: jest.fn().mockRejectedValue(new DuplicateTaskError('rtask-abc')),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(svc.createMonitoringAction(basePayload())).rejects.toBeInstanceOf(DuplicateTaskError);
  });

  it('returns SkippedDuplicate after TransactionCanceledException by name', async () => {
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
      createMonitoringTask: jest.fn().mockRejectedValueOnce({ name: 'TransactionCanceledException' }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.createMonitoringAction(basePayload());

    expect(result).toEqual({ record, outcome: 'skippedDuplicate' });
    expect(log.warn).toHaveBeenCalled();
  });

  it('generateCarePlanTasks logs info on idempotent replay', async () => {
    const record = sampleRecord();
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest.fn().mockResolvedValue(record),
      createCarePlanTask: jest.fn(),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await svc.generateCarePlanTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      patientDisplayName: 'Jane',
      carePlanInstanceId: 'cp-1',
      taskGenerationTrigger: 'carePlanActivated',
      sourceLinkageContext: {
        linkages: [
          {
            carePlanTaskLinkageId: 'link-1',
            taskBehaviorCode: 'METRIC_CHECKIN',
            taskDisplayGroup: 'checkIn',
            displayTitle: 'Check in',
            assignedToType: 'patient',
            displayToPatient: true,
            dueWindowStart: 1780581600000,
            dueWindowEnd: 1780668000000,
          },
        ],
      },
    });

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'task_care_plan_idempotent_replay' }),
    );
  });

  it('completeLinkedSourceObject paginates through query results', async () => {
    const openMeta = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      runtimeTaskInstanceId: 'rtask-open',
    };
    const repo = {
      queryPatientMetaByCompletionSource: jest
        .fn()
        .mockResolvedValueOnce({ items: [openMeta], lastEvaluatedKey: { pk: 'next' } })
        .mockResolvedValueOnce({ items: [], lastEvaluatedKey: undefined }),
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: openMeta.sk,
      }),
      completeLinkedSourceObjectTask: jest.fn().mockResolvedValue({ outcome: 'completed' }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await svc.completeLinkedSourceObject({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'formSubmission',
      completionSourceReferenceId: 'form-1',
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(repo.queryPatientMetaByCompletionSource).toHaveBeenCalledTimes(2);
  });

  it('listStaffTasks decodes nextToken cursor', async () => {
    const cursor = Buffer.from(JSON.stringify({ pk: 'GSI1' }), 'utf8').toString('base64url');
    const repo = {
      queryStaffTasksPage: jest.fn().mockResolvedValue({ items: [sampleRecord()], lastEvaluatedKey: undefined }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await svc.listStaffTasks({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      pageSize: 10,
      nextToken: cursor,
    });

    expect(repo.queryStaffTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({ exclusiveStartKey: { pk: 'GSI1' } }),
    );
  });

  it('updateTaskState propagates non-conditional repository errors', async () => {
    const record = { ...sampleRecord(), currentState: 'scheduled' as const };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
      transitionTaskState: jest.fn().mockRejectedValue(new Error('ddb-down')),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(
      svc.updateTaskState({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        action: TASK_RUNTIME_ACTION.COMPLETE,
        expectedCurrentState: 'active',
        actorId: 'pat-1',
        actorType: 'patient',
        reason: 'Done',
      }),
    ).rejects.toThrow('ddb-down');
  });

  it('checkReminderFireEligibility throws when meta is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-1', patientId: 'pat-1', taskSk: 'sk' }),
      getMetaByLookup: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(
      svc.checkReminderFireEligibility({ runtimeTaskInstanceId: 'rtask-abc' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateReminderSettings throws 403 for foreign org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-other', patientId: 'pat-1', taskSk: 'sk' }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.updateReminderSettings({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reminderEnabled: false,
        reason: 'Opt out',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('getRuntimeTaskHistory throws 403 for foreign org', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({ orgId: 'org-other', patientId: 'pat-1', taskSk: 'sk' }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.getRuntimeTaskHistory({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        pageSize: 10,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('listActionCenterItems includes carePlanInstanceId and custom timezone', async () => {
    const repo = {
      queryActionCenterTasksPage: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    const result = await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      surfaceSection: 'all',
      timezone: 'America/Chicago',
      pageSize: 10,
    });

    expect(result).toMatchObject({
      carePlanInstanceId: 'cp-1',
      timezone: 'America/Chicago',
    });
  });

  it('listPatientTasks ignores blank nextToken', async () => {
    const repo = {
      queryPatientTasksPage: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await svc.listPatientTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 10,
      nextToken: '   ',
    });

    expect(repo.queryPatientTasksPage).toHaveBeenCalledWith(
      expect.objectContaining({ exclusiveStartKey: undefined }),
    );
  });

  it('listActionCenterItems duplicates checklist-eligible tasks into carePlanChecklist section', async () => {
    const openTask = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      displayAsChecklistItem: true,
      dueWindowStart: nowEpochMs() + 3_600_000,
      dueWindowEnd: nowEpochMs() + 7_200_000,
    };
    const repo = {
      queryActionCenterTasksPage: jest.fn().mockResolvedValue({
        items: [openTask],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      surfaceSection: 'all',
      pageSize: 10,
    });

    if ('sections' in result) {
      expect(result.sections.carePlanChecklist.length).toBeGreaterThan(0);
    }
  });

  it('updateRuntimeTask throws 404 when meta is missing', async () => {
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: 'sk',
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.updateRuntimeTask({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reason: 'Edit',
        patch: { displayTitle: 'New' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateRuntimeTask rejects requiredForStageCompletion patch on completed task', async () => {
    const record = { ...sampleRecord(), currentState: 'completed' as const };
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    await expect(
      svc.updateRuntimeTask({
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reason: 'Edit',
        patch: { requiredForStageCompletion: true },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('generateCarePlanTasks returns SkippedDuplicate after TransactionCanceledException by name', async () => {
    const record = sampleRecord();
    const repo = {
      buildCarePlanTaskKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
        generationHash: 'hash',
      }),
      resolveCarePlanNaturalKey: jest
        .fn()
        .mockResolvedValueOnce('missing')
        .mockResolvedValueOnce(record),
      createCarePlanTask: jest.fn().mockRejectedValueOnce({ name: 'TransactionCanceledException' }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.generateCarePlanTasks({
      organizationId: 'org-1',
      patientId: 'pat-1',
      patientDisplayName: 'Jane',
      carePlanInstanceId: 'cp-1',
      taskGenerationTrigger: 'carePlanActivated',
      sourceLinkageContext: {
        linkages: [
          {
            carePlanTaskLinkageId: 'link-1',
            taskBehaviorCode: 'METRIC_CHECKIN',
            taskDisplayGroup: 'checkIn',
            displayTitle: 'Check in',
            assignedToType: 'patient',
            displayToPatient: true,
            dueWindowStart: 1780581600000,
            dueWindowEnd: 1780668000000,
          },
        ],
      },
    });

    expect(result.results[0].outcome).toBe('skippedDuplicate');
  });

  it('listActionCenterItems filters carePlanChecklist section', async () => {
    const openTask = {
      ...sampleRecord(),
      currentState: 'scheduled' as const,
      displayAsChecklistItem: true,
      dueWindowStart: nowEpochMs() + 3_600_000,
      dueWindowEnd: nowEpochMs() + 7_200_000,
    };
    const repo = {
      queryActionCenterTasksPage: jest.fn().mockResolvedValue({
        items: [openTask],
        lastEvaluatedKey: undefined,
      }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const result = await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      surfaceSection: 'carePlanChecklist',
      pageSize: 10,
    });

    if ('items' in result) {
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.surfaceSection).toBe('carePlanChecklist');
    }
  });

  it('createMonitoringAction rethrows TransactionCanceledException when race still missing', async () => {
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue('missing'),
      createMonitoringTask: jest.fn().mockRejectedValue({ name: 'TransactionCanceledException' }),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(svc.createMonitoringAction(basePayload())).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
  });

  it('listActionCenterItems omits carePlanInstanceId from all-section response when not provided', async () => {
    const repo = {
      queryActionCenterTasksPage: jest.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
    } as unknown as TaskRepository;
    const svc = new TaskService(repo, log);

    const result = await svc.listActionCenterItems({
      organizationId: 'org-1',
      patientId: 'pat-1',
      surfaceSection: 'all',
      pageSize: 10,
    });

    expect(result).not.toHaveProperty('carePlanInstanceId');
  });

  it('createMonitoringAction propagates non-object errors from create path', async () => {
    const repo = {
      buildMonitoringKeys: jest.fn().mockReturnValue({
        idempotencyKey: 'key',
        runtimeTaskInstanceId: 'rtask-abc',
      }),
      resolveMonitoringNaturalKey: jest.fn().mockResolvedValue('missing'),
      createMonitoringTask: jest.fn().mockRejectedValue('not-an-error-object'),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    await expect(svc.createMonitoringAction(basePayload())).rejects.toBe('not-an-error-object');
  });

  it('getRuntimeTaskDetail includes related data when includeRelated is true', async () => {
    const record = sampleRecord();
    const repo = {
      getLookupByTaskId: jest.fn().mockResolvedValue({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: record.sk,
        reminderHistory: [],
      }),
      getMetaByLookup: jest.fn().mockResolvedValue(record),
      queryCompletionEvidence: jest.fn().mockResolvedValue([]),
    } as unknown as TaskRepository;

    const svc = new TaskService(repo, log);
    const detail = await svc.getRuntimeTaskDetail({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      includeRelated: true,
    });

    expect(detail.reminders).toEqual([]);
    expect(repo.queryCompletionEvidence).toHaveBeenCalled();
  });
});