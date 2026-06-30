import { CARE_PLAN_LSI_INDEX, STAFF_TASKS_GSI_INDEX } from '../constants/task.constants';
import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import { RUNTIME_TASK_SOURCE } from '../models/types/task-domain.types';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { TaskKeyBuilder } from '../builder/task-key.builder';
import { TaskRepository } from './task-repository';

describe('TaskRepository.queryPatientTasksPage', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('queries pk-sk1 LSI when carePlanInstanceId is provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
      currentState: 'active',
      pageSize: 25,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'task-test-table',
        IndexName: CARE_PLAN_LSI_INDEX,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk1, :cpPrefix)',
        FilterExpression: 'entityType = :metaEntity AND workflowStage = :workflowStage AND currentState = :currentState',
        ExpressionAttributeValues: expect.objectContaining({
          ':pk': TaskKeyBuilder.buildPatientPartitionKey('org-1', 'pat-1'),
          ':cpPrefix': 'CP#cp-1#',
          ':metaEntity': 'RuntimeTaskInstance',
          ':workflowStage': 'onboarding',
          ':currentState': 'active',
        }),
        Limit: 25,
      }),
    );

    queryPage.mockRestore();
  });

  it('queries base table by DUE# prefix when carePlanInstanceId is omitted', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg).toMatchObject({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :duePrefix)',
      FilterExpression: 'entityType = :metaEntity',
      Limit: 10,
    });
    expect(callArg.IndexName).toBeUndefined();
    expect(callArg.ExpressionAttributeValues).toMatchObject({ ':duePrefix': 'DUE#' });

    queryPage.mockRestore();
  });

  it('excludes terminal states by default when excludeTerminalStates is true', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      excludeTerminalStates: true,
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.FilterExpression).toContain('currentState <> :terminalCompleted');
    expect(callArg.ExpressionAttributeValues).toMatchObject({
      ':terminalCompleted': 'completed',
      ':terminalDismissed': 'dismissed',
      ':terminalCancelled': 'cancelled',
    });

    queryPage.mockRestore();
  });
});

describe('TaskRepository.queryStaffTasksPage', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('queries GSI1 by gsi1pk and DUE# prefix', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryStaffTasksPage({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      patientId: 'pat-1',
      excludeTerminalStates: true,
      pageSize: 20,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'task-test-table',
        IndexName: STAFF_TASKS_GSI_INDEX,
        KeyConditionExpression: 'gsi1pk = :gsi1pk AND begins_with(gsi1sk, :duePrefix)',
        FilterExpression: expect.stringContaining('patientId = :patientId'),
        ExpressionAttributeValues: expect.objectContaining({
          ':gsi1pk': TaskKeyBuilder.buildGsi1Pk('org-1', 'staff-1'),
          ':duePrefix': 'DUE#',
          ':patientId': 'pat-1',
        }),
        Limit: 20,
      }),
    );

    queryPage.mockRestore();
  });
});

describe('TaskRepository.queryActionCenterTasksPage', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('filters displayToPatient and excludes staff-assigned tasks on base path', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryActionCenterTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 50,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :duePrefix)');
    expect(callArg.FilterExpression).toContain('displayToPatient = :displayToPatient');
    expect(callArg.FilterExpression).toContain('assignedToType = :patientAssignedToType');
    expect(callArg.FilterExpression).not.toContain('legacyPatientAssignedToType');
    expect(callArg.ExpressionAttributeValues).toMatchObject({
      ':pk': TaskKeyBuilder.buildPatientPartitionKey('org-1', 'pat-1'),
      ':displayToPatient': true,
      ':duePrefix': 'DUE#',
    });

    queryPage.mockRestore();
  });

  it('queries pk-sk1 LSI when carePlanInstanceId is provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryActionCenterTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
      pageSize: 25,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: CARE_PLAN_LSI_INDEX,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk1, :cpPrefix)',
        FilterExpression: expect.stringContaining('workflowStage = :workflowStage'),
        ExpressionAttributeValues: expect.objectContaining({
          ':cpPrefix': 'CP#cp-1#',
          ':workflowStage': 'onboarding',
        }),
        Limit: 25,
      }),
    );

    queryPage.mockRestore();
  });
});

describe('TaskRepository.transitionTaskState', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('writes META update, state HIST, and LOOKUP evidence on complete', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#0001780567200000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance' as const,
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'monitoringRuntime' as const,
      taskBehaviorCode: 'METRIC_CHECKIN' as const,
      taskDisplayGroup: 'checkIn' as const,
      displayTitle: 'Check in',
      assignedToType: 'patient' as const,
      displayToPatient: true,
      currentState: 'scheduled' as const,
      createdAt: 1,
      createdBy: 'system',
      lastUpdatedAt: 1,
      lastUpdatedBy: 'system',
      version: 1,
    };
    const lookup = {
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP' as const,
      entityType: 'TaskLookup' as const,
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: meta.sk,
      reminderHistory: [
        {
          reminderRecordId: 'rem-1',
          reminderStatus: 'scheduled',
        },
      ],
    };

    await repo.transitionTaskState({
      meta,
      lookup,
      fromState: 'scheduled',
      toState: 'completed',
      expectedPersistedState: 'scheduled',
      actorId: 'pat-1',
      reason: 'Done',
    });

    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0].Update?.ConditionExpression).toBe('currentState = :expected');
    expect(items[1].Put?.Item).toMatchObject({ historyEventType: 'stateChange' });
    expect(items[2].Update?.UpdateExpression).toContain('evidenceSummary');

    transactWrite.mockRestore();
  });
});

describe('TaskRepository.recordReminderRegistered', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('writes REM#CURRENT and appends scheduled reminderHistory', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const lookup = {
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP' as const,
      entityType: 'TaskLookup' as const,
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#0001780567200000#TASK#rtask-abc',
      reminderHistory: [],
    };

    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(lookup);
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);

    const result = await repo.recordReminderRegistered({
      runtimeTaskInstanceId: 'rtask-abc',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
      schedulerJobId: 'task-reminder-rtask-abc',
    });

    expect(result).toEqual({ written: true });
    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put?.Item).toMatchObject({
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderStatus: 'scheduled',
      schedulerJobId: 'task-reminder-rtask-abc',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
    });
    expect(items[1].Update?.ExpressionAttributeValues?.[':reminderHistory']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reminderStatus: 'scheduled',
          schedulerJobId: 'task-reminder-rtask-abc',
          scheduledReminderAt: 1_700_000_360_000,
          reminderChannel: 'push',
        }),
      ]),
    );

    transactWrite.mockRestore();
  });

  it('skips write when matching open scheduled entry already exists', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest.spyOn(
      repo as unknown as { transactWrite: jest.Mock },
      'transactWrite',
    );

    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP' as const,
      entityType: 'TaskLookup' as const,
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#0001780567200000#TASK#rtask-abc',
      reminderHistory: [
        {
          reminderRecordId: 'rem-1',
          reminderStatus: 'scheduled',
          scheduledReminderAt: 1_700_000_360_000,
          reminderChannel: 'push',
          schedulerJobId: 'task-reminder-rtask-abc',
          createdAt: 1,
        },
      ],
    });

    const result = await repo.recordReminderRegistered({
      runtimeTaskInstanceId: 'rtask-abc',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
      schedulerJobId: 'task-reminder-rtask-abc',
    });

    expect(result).toEqual({ written: false });
    expect(transactWrite).not.toHaveBeenCalled();
    transactWrite.mockRestore();
  });
});

describe('TaskRepository.recordReminderCancelled', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('appends cancelled rows for open scheduled reminders', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const lookup = {
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP' as const,
      entityType: 'TaskLookup' as const,
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#0001780567200000#TASK#rtask-abc',
      reminderHistory: [
        {
          reminderRecordId: 'rem-1',
          reminderStatus: 'scheduled',
          scheduledReminderAt: 1_700_000_360_000,
          reminderChannel: 'push',
          schedulerJobId: 'task-reminder-rtask-abc',
          createdAt: 1,
        },
      ],
    };

    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(lookup);
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
      schedulerJobId: 'task-reminder-rtask-abc',
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await repo.recordReminderCancelled({
      runtimeTaskInstanceId: 'rtask-abc',
      reason: 'remindersDisabled',
    });

    expect(result).toEqual({ written: true });
    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    const history = items[0].Update?.ExpressionAttributeValues?.[':reminderHistory'] as Array<{
      reminderStatus: string;
    }>;
    expect(history).toHaveLength(2);
    expect(history[1].reminderStatus).toBe('cancelled');
    expect(items[1].Update?.ExpressionAttributeValues?.[':cancelled']).toBe('cancelled');

    transactWrite.mockRestore();
  });
});

describe('TaskRepository.recordReminderOutcome', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('updates REM#CURRENT and appends sent row on LOOKUP', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP' as const,
      entityType: 'TaskLookup' as const,
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#0001780567200000#TASK#rtask-abc',
      reminderHistory: [
        {
          reminderRecordId: 'rem-1',
          reminderStatus: 'scheduled',
          scheduledReminderAt: 1_700_000_360_000,
          reminderChannel: 'push',
          schedulerJobId: 'task-reminder-rtask-abc',
          createdAt: 1,
        },
      ],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
      schedulerJobId: 'task-reminder-rtask-abc',
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await repo.recordReminderOutcome({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'sent',
    });

    expect(result).toEqual({ written: true });
    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items[0].Put?.Item).toMatchObject({ reminderStatus: 'sent' });
    expect(items[1].Update?.ExpressionAttributeValues?.[':reminderHistory']).toEqual(
      expect.arrayContaining([expect.objectContaining({ reminderStatus: 'sent' })]),
    );

    transactWrite.mockRestore();
  });
});

describe('TaskRepository.queryCarePlanTasksForSummaryPage', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('queries pk-sk1 LSI without excluding terminal states', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryCarePlanTasksForSummaryPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
      pageSize: 200,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: CARE_PLAN_LSI_INDEX,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk1, :cpPrefix)',
        FilterExpression: 'entityType = :metaEntity AND workflowStage = :workflowStage',
        ExpressionAttributeValues: expect.objectContaining({
          ':cpPrefix': 'CP#cp-1#',
          ':workflowStage': 'onboarding',
        }),
        Limit: 200,
      }),
    );

    queryPage.mockRestore();
  });
});

describe('TaskRepository.updateReminderSettings', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const baseMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'scheduled',
    reminderEnabled: true,
    reminderSettings: { channels: ['push'] },
    version: 2,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('transacts META update and settings change HIST', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.updateReminderSettings({
      meta: baseMeta,
      actorId: 'staff-1',
      reminderEnabled: false,
      reminderSettings: { channels: ['push'] },
      reason: 'Patient opted out',
    });

    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      Update: expect.objectContaining({
        TableName: 'task-test-table',
        Key: { pk: baseMeta.pk, sk: baseMeta.sk },
      }),
    });
    expect(items[1].Put.Item).toMatchObject({
      historyEventType: 'reminderSettingsChange',
      newReminderEnabled: false,
    });

    transactWrite.mockRestore();
  });
});

describe('TaskRepository.updateRuntimeTask', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const baseMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    patientDisplayName: 'Jane Doe',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'scheduled',
    version: 2,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  const baseLookup = {
    pk: 'TASK#rtask-abc',
    sk: 'LOOKUP' as const,
    entityType: 'TaskLookup' as const,
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    patientDisplayName: 'Jane Doe',
    taskSk: baseMeta.sk,
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('transacts META update, LOOKUP patientDisplayName, and metadata HIST', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.updateRuntimeTask({
      meta: baseMeta,
      lookup: baseLookup,
      actorId: 'staff-1',
      reason: 'Portal edit',
      diff: {
        changedFields: ['displayTitle', 'patientDisplayName'],
        previousValues: { displayTitle: 'Check in', patientDisplayName: 'Jane Doe' },
        newValues: { displayTitle: 'Updated title', patientDisplayName: 'Jane D.' },
        metaUpdates: { displayTitle: 'Updated title', patientDisplayName: 'Jane D.' },
        lookupUpdates: { patientDisplayName: 'Jane D.' },
      },
    });

    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(3);
    expect(items[0].Update?.UpdateExpression).toContain('displayTitle');
    expect(items[1].Update?.Key).toEqual({ pk: 'TASK#rtask-abc', sk: 'LOOKUP' });
    expect(items[2].Put?.Item).toMatchObject({
      historyEventType: 'taskMetadataChange',
      changedFields: ['displayTitle', 'patientDisplayName'],
    });

    transactWrite.mockRestore();
  });
});

const monitoringInput: CreateMonitoringActionRequest = {
  organizationId: 'org-1',
  patientId: 'pat-1',
  patientDisplayName: 'Jane Doe',
  carePlanInstanceId: 'cp-1',
  monitoringInstanceId: 'mon-1',
  taskBehaviorCode: 'METRIC_CHECKIN',
  assignedToType: 'patient',
  dueWindowStart: 1780581600000,
  dueWindowEnd: 1780668000000,
};

const carePlanInput: CreateCarePlanTaskRequest = {
  organizationId: 'org-1',
  createdBy: 'system:care-plan-runtime',
  patientId: 'pat-1',
  patientDisplayName: 'Jane Doe',
  carePlanInstanceId: 'cp-1',
  taskGenerationTrigger: 'carePlanActivated',
  carePlanTaskLinkageId: 'link-1',
  taskBehaviorCode: 'METRIC_CHECKIN',
  taskDisplayGroup: 'checkIn',
  displayTitle: 'Check in',
  assignedToType: 'patient',
  displayToPatient: true,
  dueWindowStart: 1780581600000,
  dueWindowEnd: 1780668000000,
};

const runtimeTaskInput: CreateRuntimeTaskRequest = {
  organizationId: 'org-1',
  createdBy: 'staff-1',
  patientId: 'pat-1',
  patientDisplayName: 'Jane Doe',
  runtimeTaskSource: RUNTIME_TASK_SOURCE.MANUAL_SYSTEM,
  taskBehaviorCode: 'METRIC_CHECKIN',
  taskDisplayGroup: 'checkIn',
  displayTitle: 'Manual task',
  assignedToType: 'patient',
  displayToPatient: true,
  dueWindowStart: 1780581600000,
  dueWindowEnd: 1780668000000,
};

describe('TaskRepository.buildMonitoringKeys', () => {
  it('returns idempotency key and deterministic runtime task id', () => {
    const repo = new TaskRepository();
    const keys = repo.buildMonitoringKeys(monitoringInput);

    expect(keys.idempotencyKey).toContain('org-1');
    expect(keys.runtimeTaskInstanceId).toMatch(/^rtask-/);
  });
});

describe('TaskRepository.resolveMonitoringNaturalKey', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('returns missing when lookup is absent', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue(null);

    const result = await repo.resolveMonitoringNaturalKey('rtask-abc', 'org-1');
    expect(result).toBe('missing');
  });

  it('returns foreign_org when lookup belongs to another org', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue({
      orgId: 'org-other',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
    });

    const result = await repo.resolveMonitoringNaturalKey('rtask-abc', 'org-1');
    expect(result).toBe('foreign_org');
  });

  it('returns meta when lookup and meta exist', async () => {
    const repo = new TaskRepository();
    const meta = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance' as const,
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'monitoringRuntime' as const,
      taskBehaviorCode: 'METRIC_CHECKIN' as const,
      taskDisplayGroup: 'checkIn' as const,
      displayTitle: 'Check in',
      assignedToType: 'patient' as const,
      displayToPatient: true,
      currentState: 'scheduled' as const,
      createdAt: 1,
      createdBy: 'system',
      lastUpdatedAt: 1,
      lastUpdatedBy: 'system',
    };
    jest
      .spyOn(repo as unknown as { get: jest.Mock }, 'get')
      .mockResolvedValueOnce({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      })
      .mockResolvedValueOnce(meta);

    const result = await repo.resolveMonitoringNaturalKey('rtask-abc', 'org-1');
    expect(result).toEqual(meta);
  });
});

describe('TaskRepository lookups and history queries', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('getLookupByTaskId, getReminderCurrent, getMetaByLookup, and queryTaskHistory delegate to get/query', async () => {
    const repo = new TaskRepository();
    const get = jest.spyOn(repo as unknown as { get: jest.Mock }, 'get');
    const query = jest.spyOn(repo as unknown as { query: jest.Mock }, 'query');

    get.mockResolvedValueOnce({ sk: 'LOOKUP' });
    await expect(repo.getLookupByTaskId('rtask-abc')).resolves.toEqual({ sk: 'LOOKUP' });

    get.mockResolvedValueOnce({ sk: 'REM#CURRENT' });
    await expect(repo.getReminderCurrent('rtask-abc')).resolves.toEqual({ sk: 'REM#CURRENT' });

    get.mockResolvedValueOnce({ currentState: 'scheduled' });
    await expect(
      repo.getMetaByLookup({
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: 'DUE#1#TASK#rtask-abc',
      }),
    ).resolves.toEqual({ currentState: 'scheduled' });

    query.mockResolvedValueOnce([{ sk: 'HIST#1' }]);
    await expect(repo.queryTaskHistory('rtask-abc')).resolves.toEqual([{ sk: 'HIST#1' }]);
  });

  it('queryCompletionEvidence queries EVID# prefix', async () => {
    const repo = new TaskRepository();
    const query = jest
      .spyOn(repo as unknown as { query: jest.Mock }, 'query')
      .mockResolvedValue([{ sk: 'EVID#1' }]);

    await expect(repo.queryCompletionEvidence('rtask-abc')).resolves.toEqual([{ sk: 'EVID#1' }]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ':prefix': 'EVID#' }),
      }),
    );
  });

  it('queryTaskHistoryPage omits exclusiveStartKey when not provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryTaskHistoryPage('rtask-abc', 10);

    expect(queryPage).toHaveBeenCalledWith(
      expect.not.objectContaining({ ExclusiveStartKey: expect.anything() }),
    );
  });

  it('queryTaskHistoryPage passes exclusiveStartKey when provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: { pk: 'next' } });

    await repo.queryTaskHistoryPage('rtask-abc', 10, { pk: 'cursor' });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        Limit: 10,
        ExclusiveStartKey: { pk: 'cursor' },
      }),
    );
  });

  it('queryPatientMetaByCompletionSource filters by completion source fields', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientMetaByCompletionSource({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'formSubmission',
      completionSourceReferenceId: 'form-123',
      pageSize: 25,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        FilterExpression: expect.stringContaining('completionSourceType = :completionSourceType'),
        ExpressionAttributeValues: expect.objectContaining({
          ':completionSourceType': 'formSubmission',
          ':completionSourceReferenceId': 'form-123',
        }),
        ExclusiveStartKey: { pk: 'cursor' },
      }),
    );
  });
});

describe('TaskRepository.queryStaffTasksPage filters', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('applies carePlanInstanceId and currentState filters', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryStaffTasksPage({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      carePlanInstanceId: 'cp-1',
      currentState: 'scheduled',
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.FilterExpression).toContain('carePlanInstanceId = :carePlanInstanceId');
    expect(callArg.FilterExpression).toContain('currentState = :currentState');
    expect(callArg.ExpressionAttributeValues).toMatchObject({
      ':carePlanInstanceId': 'cp-1',
      ':currentState': 'scheduled',
    });
  });
});

describe('TaskRepository.createMonitoringTask', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('writes META, LOOKUP, and HIST on success', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const record = await repo.createMonitoringTask(monitoringInput);

    expect(record.runtimeTaskInstanceId).toBeDefined();
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(3);
    transactWrite.mockRestore();
  });

  it('throws DuplicateTaskError on meta conditional failure', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });

    await expect(repo.createMonitoringTask(monitoringInput)).rejects.toBeInstanceOf(DuplicateTaskError);
  });

  it('rethrows non-conditional errors', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue(new Error('boom'));

    await expect(repo.createMonitoringTask(monitoringInput)).rejects.toThrow('boom');
  });
});

describe('TaskRepository.createCarePlanTask', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('buildCarePlanTaskKeys and resolveCarePlanNaturalKey delegate to monitoring helpers', async () => {
    const repo = new TaskRepository();
    const keys = repo.buildCarePlanTaskKeys(carePlanInput);
    expect(keys.runtimeTaskInstanceId).toMatch(/^rtask-/);

    jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue(null);
    await expect(repo.resolveCarePlanNaturalKey('rtask-abc', 'org-1')).resolves.toBe('missing');
  });

  it('writes care plan task records on success', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const record = await repo.createCarePlanTask(carePlanInput);
    expect(record.carePlanInstanceId).toBe('cp-1');
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(3);
    transactWrite.mockRestore();
  });

  it('throws DuplicateTaskError on conditional failure', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });

    await expect(repo.createCarePlanTask(carePlanInput)).rejects.toBeInstanceOf(DuplicateTaskError);
  });

  it('rethrows non-conditional errors', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue(new Error('boom'));

    await expect(repo.createCarePlanTask(carePlanInput)).rejects.toThrow('boom');
  });
});

describe('TaskRepository.createRuntimeTask', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('writes runtime task records on success', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const record = await repo.createRuntimeTask(runtimeTaskInput);
    expect(record.displayTitle).toBe('Manual task');
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(3);
    transactWrite.mockRestore();
  });

  it('throws DuplicateTaskError on conditional failure', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });

    await expect(repo.createRuntimeTask(runtimeTaskInput)).rejects.toBeInstanceOf(DuplicateTaskError);
  });
});

describe('TaskRepository.reassignStaffTask', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const staffMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'orgStaff',
    assignedToStaffId: 'staff-old',
    assignedToStaffDisplayName: 'Old Nurse',
    displayToPatient: true,
    currentState: 'scheduled',
    dueWindowStart: 1780581600000,
    dueWindowEnd: 1780668000000,
    gsi1pk: 'ORG#org-1#STAFF#staff-old',
    gsi1sk: 'DUE#1780581600000#PAT#pat-1#TASK#rtask-abc',
    version: 1,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  const staffLookup = {
    pk: 'TASK#rtask-abc',
    sk: 'LOOKUP' as const,
    entityType: 'TaskLookup' as const,
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    taskSk: staffMeta.sk,
    dueWindowStart: 1780581600000,
    dueWindowEnd: 1780668000000,
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('includes gsi1sk on first staff assignment', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const metaWithoutStaff = { ...staffMeta, assignedToStaffId: undefined, gsi1pk: undefined, gsi1sk: undefined };
    const result = await repo.reassignStaffTask({
      meta: metaWithoutStaff,
      lookup: staffLookup,
      actorId: 'admin-1',
      assignedToStaffId: 'staff-new',
      assignedToStaffDisplayName: 'New Nurse',
      reason: 'Coverage',
    });

    expect(result.record.assignedToStaffId).toBe('staff-new');
    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.UpdateExpression).toContain('gsi1sk');
    transactWrite.mockRestore();
  });

  it('omits gsi1sk update on subsequent reassignment', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.reassignStaffTask({
      meta: staffMeta,
      lookup: staffLookup,
      actorId: 'admin-1',
      assignedToStaffId: 'staff-new',
      assignedToStaffDisplayName: 'New Nurse',
      reason: 'Coverage',
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.UpdateExpression).not.toContain('gsi1sk');
    transactWrite.mockRestore();
  });

  it('first assignment preserves existing gsi1sk on meta when present', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const metaWithGsi = {
      ...staffMeta,
      assignedToStaffId: undefined,
      gsi1pk: undefined,
      gsi1sk: 'DUE#1780581600000#PAT#pat-1#TASK#rtask-abc',
    };

    const result = await repo.reassignStaffTask({
      meta: metaWithGsi,
      lookup: staffLookup,
      actorId: 'admin-1',
      assignedToStaffId: 'staff-new',
      assignedToStaffDisplayName: 'New Nurse',
      reason: 'Coverage',
    });

    expect(result.record.gsi1sk).toBe('DUE#1780581600000#PAT#pat-1#TASK#rtask-abc');
    transactWrite.mockRestore();
  });
});

describe('TaskRepository.transitionTaskState branches', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const baseMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'scheduled',
    version: 1,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  const baseLookup = {
    pk: 'TASK#rtask-abc',
    sk: 'LOOKUP' as const,
    entityType: 'TaskLookup' as const,
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    taskSk: baseMeta.sk,
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('writes evidence summary when transitioning to missed', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.transitionTaskState({
      meta: baseMeta,
      lookup: baseLookup,
      fromState: 'scheduled',
      toState: 'missed',
      expectedPersistedState: 'scheduled',
      actorId: 'system',
      reason: 'Due window elapsed',
      nowMs: 1780700000000,
    });

    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(3);
    expect(items[2].Update?.UpdateExpression).toContain('evidenceSummary');
    transactWrite.mockRestore();
  });

  it('writes manual completion evidence when payload is provided', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.transitionTaskState({
      meta: baseMeta,
      lookup: baseLookup,
      fromState: 'scheduled',
      toState: 'completed',
      expectedPersistedState: 'scheduled',
      actorId: 'pat-1',
      reason: 'Done',
      evidencePayload: { note: 'completed manually' },
      nowMs: 1780700000000,
    });

    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(4);
    expect(items[3].Put?.Item).toMatchObject({ sk: expect.stringContaining('EVID#') });
    transactWrite.mockRestore();
  });

  it('writes lookup evidence summary on completed without manual evidence payload', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.transitionTaskState({
      meta: baseMeta,
      lookup: baseLookup,
      fromState: 'scheduled',
      toState: 'completed',
      expectedPersistedState: 'scheduled',
      actorId: 'pat-1',
      reason: 'Done',
      nowMs: 1780700000000,
    });

    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(3);
    transactWrite.mockRestore();
  });
});

describe('TaskRepository.updateReminderSettings branches', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const baseMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'scheduled',
    reminderEnabled: true,
    version: 1,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('updates reminderEnabled without reminderSettings when settings are omitted', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const result = await repo.updateReminderSettings({
      meta: baseMeta,
      actorId: 'staff-1',
      reminderEnabled: false,
      reason: 'Opt out',
    });

    expect(result.record.reminderEnabled).toBe(false);
    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.UpdateExpression).not.toContain(
      'reminderSettings',
    );
    transactWrite.mockRestore();
  });

  it('updates reminderSettings when settings are provided', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const result = await repo.updateReminderSettings({
      meta: baseMeta,
      actorId: 'staff-1',
      reminderEnabled: true,
      reminderSettings: { channels: ['push', 'email'] },
      reason: 'Add email',
    });

    expect(result.record.reminderSettings).toEqual({ channels: ['push', 'email'] });
    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.UpdateExpression).toContain(
      'reminderSettings',
    );
    transactWrite.mockRestore();
  });
});

describe('TaskRepository.updateRuntimeTask branches', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const baseMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'monitoringRuntime',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'scheduled',
    version: 1,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  const baseLookup = {
    pk: 'TASK#rtask-abc',
    sk: 'LOOKUP' as const,
    entityType: 'TaskLookup' as const,
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    taskSk: baseMeta.sk,
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('skips LOOKUP update when patientDisplayName is unchanged', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.updateRuntimeTask({
      meta: baseMeta,
      lookup: baseLookup,
      actorId: 'staff-1',
      reason: 'Portal edit',
      diff: {
        changedFields: ['displayTitle'],
        previousValues: { displayTitle: 'Check in' },
        newValues: { displayTitle: 'Updated title' },
        metaUpdates: { displayTitle: 'Updated title' },
        lookupUpdates: {},
      },
    });

    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(2);
    transactWrite.mockRestore();
  });
});

describe('TaskRepository.completeLinkedSourceObjectTask', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  const baseMeta: TaskMetaDdbRecord = {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#1780581600000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'serviceFlowRuntime',
    taskBehaviorCode: 'FORM_COMPLETION',
    taskDisplayGroup: 'form',
    displayTitle: 'Complete form',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: 'scheduled',
    version: 1,
    createdAt: 1780581600000,
    createdBy: 'system',
    lastUpdatedAt: 1780581600000,
    lastUpdatedBy: 'system',
  };

  const baseLookup = {
    pk: 'TASK#rtask-abc',
    sk: 'LOOKUP' as const,
    entityType: 'TaskLookup' as const,
    runtimeTaskInstanceId: 'rtask-abc',
    orgId: 'org-1',
    patientId: 'pat-1',
    taskSk: baseMeta.sk,
    reminderHistory: [
      {
        reminderRecordId: 'rem-1',
        reminderStatus: 'scheduled',
        scheduledReminderAt: 1780668000000,
        reminderChannel: 'push',
        schedulerJobId: 'job-1',
        createdAt: 1,
      },
    ],
  };

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('completes task and cancels scheduled reminder', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1780668000000,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const result = await repo.completeLinkedSourceObjectTask({
      meta: baseMeta,
      lookup: baseLookup,
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(result).toEqual({ outcome: 'completed' });
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(5);
    transactWrite.mockRestore();
  });

  it('returns skippedDuplicate when evidence already exists', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
      name: 'TransactionCanceledException',
      CancellationReasons: [
        { Code: 'None' },
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ],
    });

    const result = await repo.completeLinkedSourceObjectTask({
      meta: baseMeta,
      lookup: baseLookup,
      completionEventId: 'evt-dup',
      completedAt: 1780700000000,
    });

    expect(result).toEqual({ outcome: 'skippedDuplicate' });
  });
});

describe('TaskRepository.recordReminder edge cases', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('recordReminderRegistered throws when lookup is missing', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(null);

    await expect(
      repo.recordReminderRegistered({
        runtimeTaskInstanceId: 'rtask-missing',
        scheduledAt: 1,
        channel: 'push',
        schedulerJobId: 'job-1',
      }),
    ).rejects.toThrow('LOOKUP not found');
  });

  it('recordReminderCancelled returns written false when nothing to cancel', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);

    const result = await repo.recordReminderCancelled({
      runtimeTaskInstanceId: 'rtask-abc',
      reason: 'remindersDisabled',
    });

    expect(result).toEqual({ written: false });
  });

  it('recordReminderOutcome writes suppressed outcome without existing reminder', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const result = await repo.recordReminderOutcome({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'suppressed',
      reason: 'quietHours',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
    });

    expect(result).toEqual({ written: true });
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(1);
    transactWrite.mockRestore();
  });

  it('recordReminderOutcome writes failed outcome with existing reminder', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.recordReminderOutcome({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'failed',
      reason: 'providerError',
    });

    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put?.Item).toMatchObject({ reminderStatus: 'failed' });
    transactWrite.mockRestore();
  });

  it('recordReminderRegistered reuses existing reminder createdAt', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-old',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'cancelled',
      scheduledReminderAt: 1,
      reminderChannel: 'push',
      schedulerJobId: 'job-old',
      createdAt: 99,
      updatedAt: 99,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.recordReminderRegistered({
      runtimeTaskInstanceId: 'rtask-abc',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
      schedulerJobId: 'job-new',
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Put?.Item).toMatchObject({
      createdAt: 99,
    });
    transactWrite.mockRestore();
  });
});

describe('TaskRepository pagination and filter branches', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('queryPatientTasksPage passes exclusiveStartKey on base-table path', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 10,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({ ExclusiveStartKey: { pk: 'cursor' } }),
    );
    queryPage.mockRestore();
  });

  it('queryCarePlanTasksForSummaryPage omits workflowStage filter when not provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: { pk: 'next' } });

    await repo.queryCarePlanTasksForSummaryPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      pageSize: 50,
      exclusiveStartKey: { pk: 'cursor' },
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.FilterExpression).toBe('entityType = :metaEntity');
    expect(callArg.ExclusiveStartKey).toEqual({ pk: 'cursor' });
    queryPage.mockRestore();
  });

  it('queryStaffTasksPage passes exclusiveStartKey', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryStaffTasksPage({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      pageSize: 10,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({ ExclusiveStartKey: { pk: 'cursor' } }),
    );
    queryPage.mockRestore();
  });

  it('resolveMonitoringNaturalKey returns missing when meta is absent', async () => {
    const repo = new TaskRepository();
    jest
      .spyOn(repo as unknown as { get: jest.Mock }, 'get')
      .mockResolvedValueOnce({
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: 'DUE#1#TASK#rtask-abc',
      })
      .mockResolvedValueOnce(null);

    await expect(repo.resolveMonitoringNaturalKey('rtask-abc', 'org-1')).resolves.toBe('missing');
  });

  it('updateRuntimeTask builds update expression for multiple changed fields', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'monitoringRuntime',
      taskBehaviorCode: 'METRIC_CHECKIN',
      taskDisplayGroup: 'checkIn',
      displayTitle: 'Check in',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.updateRuntimeTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      actorId: 'staff-1',
      reason: 'Edit',
      diff: {
        changedFields: ['displayTitle', 'description'],
        previousValues: { displayTitle: 'Check in', description: 'Old' },
        newValues: { displayTitle: 'New title', description: 'New desc' },
        metaUpdates: { displayTitle: 'New title', description: 'New desc' },
        lookupUpdates: {},
      },
    });

    const updateExpr = transactWrite.mock.calls[0][0].TransactItems[0].Update?.UpdateExpression as string;
    expect(updateExpr).toContain('#displayTitle');
    expect(updateExpr).toContain('#description');
    transactWrite.mockRestore();
  });

  it('completeLinkedSourceObjectTask completes without cancelling reminder when none scheduled', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    const result = await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
      actorId: 'system:linked-source',
    });

    expect(result).toEqual({ outcome: 'completed' });
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(4);
    transactWrite.mockRestore();
  });

  it('queryPatientTasksPage uses base table when carePlanInstanceId is blank', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: '   ',
      currentState: 'scheduled',
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.KeyConditionExpression).toContain('begins_with(sk, :duePrefix)');
    expect(callArg.FilterExpression).toContain('currentState = :currentState');
    queryPage.mockRestore();
  });

  it('completeLinkedSourceObjectTask skips reminder cancel when status is not scheduled', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'sent',
      scheduledReminderAt: 1,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(4);
    transactWrite.mockRestore();
  });

  it('completeLinkedSourceObjectTask rethrows meta conditional failure', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await expect(
      repo.completeLinkedSourceObjectTask({
        meta,
        lookup: {
          pk: 'TASK#rtask-abc',
          sk: 'LOOKUP',
          entityType: 'TaskLookup',
          runtimeTaskInstanceId: 'rtask-abc',
          orgId: 'org-1',
          patientId: 'pat-1',
          taskSk: meta.sk,
        },
        completionEventId: 'evt-1',
        completedAt: 1780700000000,
      }),
    ).rejects.toMatchObject({ name: 'TransactionCanceledException' });
  });

  it('recordReminderCancelled updates REM#CURRENT when history has no open scheduled rows', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const result = await repo.recordReminderCancelled({
      runtimeTaskInstanceId: 'rtask-abc',
      reason: 'remindersDisabled',
    });

    expect(result).toEqual({ written: true });
    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(1);
    transactWrite.mockRestore();
  });

  it('transitionTaskState writes only meta and history for non-terminal transitions', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'monitoringRuntime',
      taskBehaviorCode: 'METRIC_CHECKIN',
      taskDisplayGroup: 'checkIn',
      displayTitle: 'Check in',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.transitionTaskState({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      fromState: 'scheduled',
      toState: 'scheduled',
      expectedPersistedState: 'scheduled',
      actorId: 'system',
      reason: 'Scheduled',
    });

    expect(transactWrite.mock.calls[0][0].TransactItems).toHaveLength(2);
    transactWrite.mockRestore();
  });

  it('queryPatientTasksPage applies workflowStage without terminal exclusion', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      workflowStage: 'onboarding',
      excludeTerminalStates: false,
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.FilterExpression).toContain('workflowStage = :workflowStage');
    expect(callArg.FilterExpression).not.toContain(':terminalCompleted');
    queryPage.mockRestore();
  });

  it('queryPatientTasksPage passes exclusiveStartKey on LSI path', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      pageSize: 10,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: CARE_PLAN_LSI_INDEX,
        ExclusiveStartKey: { pk: 'cursor' },
      }),
    );
    queryPage.mockRestore();
  });

  it('queryStaffTasksPage excludes terminal states when currentState is omitted', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryStaffTasksPage({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      excludeTerminalStates: true,
      pageSize: 10,
    });

    expect(queryPage.mock.calls[0][0].FilterExpression).toContain(':terminalCompleted');
    queryPage.mockRestore();
  });

  it('queryActionCenterTasksPage passes exclusiveStartKey on LSI path', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryActionCenterTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      pageSize: 10,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: CARE_PLAN_LSI_INDEX,
        ExclusiveStartKey: { pk: 'cursor' },
      }),
    );
    queryPage.mockRestore();
  });

  it('completeLinkedSourceObjectTask uses custom actorId and nowMs overrides', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
      actorId: 'staff-1',
      nowMs: 1780700001000,
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.ExpressionAttributeValues).toMatchObject({
      ':by': 'staff-1',
      ':now': 1780700001000,
    });
    transactWrite.mockRestore();
  });

  it('completeLinkedSourceObjectTask rethrows unexpected errors', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue(new Error('boom'));

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await expect(
      repo.completeLinkedSourceObjectTask({
        meta,
        lookup: {
          pk: 'TASK#rtask-abc',
          sk: 'LOOKUP',
          entityType: 'TaskLookup',
          runtimeTaskInstanceId: 'rtask-abc',
          orgId: 'org-1',
          patientId: 'pat-1',
          taskSk: meta.sk,
        },
        completionEventId: 'evt-1',
        completedAt: 1780700000000,
      }),
    ).rejects.toThrow('boom');
  });

  it('recordReminderCancelled throws when lookup is missing', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(null);

    await expect(
      repo.recordReminderCancelled({
        runtimeTaskInstanceId: 'rtask-missing',
        reason: 'disabled',
      }),
    ).rejects.toThrow('LOOKUP not found');
  });

  it('recordReminderOutcome throws when lookup is missing', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(null);

    await expect(
      repo.recordReminderOutcome({
        runtimeTaskInstanceId: 'rtask-missing',
        outcome: 'sent',
      }),
    ).rejects.toThrow('LOOKUP not found');
  });

  it('completeLinkedSourceObjectTask handles lookup without reminderHistory', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(transactWrite).toHaveBeenCalled();
    transactWrite.mockRestore();
  });

  it('queryStaffTasksPage trims patientId filter value', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryStaffTasksPage({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      patientId: '  pat-1  ',
      pageSize: 10,
    });

    expect(queryPage.mock.calls[0][0].ExpressionAttributeValues[':patientId']).toBe('pat-1');
    queryPage.mockRestore();
  });

  it('queryActionCenterTasksPage trims carePlanInstanceId and uses exclusiveStartKey on base path', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryActionCenterTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: '  cp-1  ',
      pageSize: 10,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: CARE_PLAN_LSI_INDEX,
        ExpressionAttributeValues: expect.objectContaining({ ':cpPrefix': 'CP#cp-1#' }),
        ExclusiveStartKey: { pk: 'cursor' },
      }),
    );
    queryPage.mockRestore();
  });

  it('queryPatientTasksPage prefers currentState filter over terminal exclusion', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      currentState: 'scheduled',
      excludeTerminalStates: true,
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg.FilterExpression).toContain('currentState = :currentState');
    expect(callArg.FilterExpression).not.toContain(':terminalCompleted');
    queryPage.mockRestore();
  });

  it('completeLinkedSourceObjectTask uses default linked-source actor when actorId omitted', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.ExpressionAttributeValues?.[':by']).toBe(
      'system:linked-source',
    );
    transactWrite.mockRestore();
  });

  it('queryCarePlanTasksForSummaryPage omits exclusiveStartKey when not provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryCarePlanTasksForSummaryPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      pageSize: 50,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.not.objectContaining({ ExclusiveStartKey: expect.anything() }),
    );
    queryPage.mockRestore();
  });

  it('queryStaffTasksPage omits exclusiveStartKey when not provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryStaffTasksPage({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      pageSize: 10,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.not.objectContaining({ ExclusiveStartKey: expect.anything() }),
    );
    queryPage.mockRestore();
  });

  it('queryPatientMetaByCompletionSource passes exclusiveStartKey when provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientMetaByCompletionSource({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'formSubmission',
      completionSourceReferenceId: 'form-123',
      pageSize: 25,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({ ExclusiveStartKey: { pk: 'cursor' } }),
    );
    queryPage.mockRestore();
  });

  it('completeLinkedSourceObjectTask defaults version when meta.version is absent', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue(null);
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance' as const,
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime' as const,
      taskBehaviorCode: 'FORM_COMPLETION' as const,
      taskDisplayGroup: 'form' as const,
      displayTitle: 'Complete form',
      assignedToType: 'patient' as const,
      displayToPatient: true,
      currentState: 'scheduled' as const,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      completionEventId: 'evt-1',
      completedAt: 1780700000000,
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.ExpressionAttributeValues?.[':nextVer']).toBe(2);
    transactWrite.mockRestore();
  });

  it('createRuntimeTask rethrows non-conditional errors', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue(new Error('boom'));

    await expect(repo.createRuntimeTask(runtimeTaskInput)).rejects.toThrow('boom');
  });

  it('transitionTaskState uses Date.now when nowMs is omitted', async () => {
    const repo = new TaskRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1780700000000);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'monitoringRuntime',
      taskBehaviorCode: 'METRIC_CHECKIN',
      taskDisplayGroup: 'checkIn',
      displayTitle: 'Check in',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.transitionTaskState({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
      },
      fromState: 'scheduled',
      toState: 'scheduled',
      expectedPersistedState: 'scheduled',
      actorId: 'system',
      reason: 'Scheduled',
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Update?.ExpressionAttributeValues?.[':now']).toBe(
      1780700000000,
    );
    nowSpy.mockRestore();
    transactWrite.mockRestore();
  });

  it('updateReminderSettings return preserves reminderSettings when input settings are omitted', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'monitoringRuntime',
      taskBehaviorCode: 'METRIC_CHECKIN',
      taskDisplayGroup: 'checkIn',
      displayTitle: 'Check in',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      reminderEnabled: true,
      reminderSettings: { channels: ['push'] },
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    const result = await repo.updateReminderSettings({
      meta,
      actorId: 'staff-1',
      reminderEnabled: false,
      reason: 'Opt out',
    });

    expect(result.record.reminderEnabled).toBe(false);
    expect(result.record.reminderSettings).toEqual({ channels: ['push'] });
  });

  it('createMonitoringTask rethrows non-conditional errors', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue(new Error('boom'));

    await expect(repo.createMonitoringTask(monitoringInput)).rejects.toThrow('boom');
  });

  it('queryActionCenterTasksPage passes exclusiveStartKey on base due path', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryActionCenterTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 10,
      exclusiveStartKey: { pk: 'cursor' },
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :duePrefix)',
        ExclusiveStartKey: { pk: 'cursor' },
      }),
    );
    queryPage.mockRestore();
  });

  it('recordReminderOutcome builds record id when existing reminder lacks schedulerJobId', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.recordReminderOutcome({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'sent',
      schedulerJobId: '',
    });

    expect(transactWrite).toHaveBeenCalled();
    transactWrite.mockRestore();
  });

  it('queryPatientMetaByCompletionSource omits exclusiveStartKey when not provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientMetaByCompletionSource({
      organizationId: 'org-1',
      patientId: 'pat-1',
      completionSourceType: 'form',
      completionSourceReferenceId: 'form-1',
      pageSize: 10,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.not.objectContaining({ ExclusiveStartKey: expect.anything() }),
    );
    queryPage.mockRestore();
  });

  it('completeLinkedSourceObjectTask cancels scheduled reminder in transact write', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1780668000000,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    const meta: TaskMetaDdbRecord = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: 'DUE#1780581600000#TASK#rtask-abc',
      entityType: 'RuntimeTaskInstance',
      orgId: 'org-1',
      patientId: 'pat-1',
      runtimeTaskInstanceId: 'rtask-abc',
      runtimeTaskSource: 'serviceFlowRuntime',
      taskBehaviorCode: 'FORM_COMPLETION',
      taskDisplayGroup: 'form',
      displayTitle: 'Complete form',
      assignedToType: 'patient',
      displayToPatient: true,
      currentState: 'scheduled',
      version: 1,
      createdAt: 1780581600000,
      createdBy: 'system',
      lastUpdatedAt: 1780581600000,
      lastUpdatedBy: 'system',
    };

    await repo.completeLinkedSourceObjectTask({
      meta,
      lookup: {
        pk: 'TASK#rtask-abc',
        sk: 'LOOKUP',
        entityType: 'TaskLookup',
        runtimeTaskInstanceId: 'rtask-abc',
        orgId: 'org-1',
        patientId: 'pat-1',
        taskSk: meta.sk,
        reminderHistory: [],
      },
      completionEventId: 'evt-cancel-rem',
      completedAt: 1780700000000,
    });

    const cancelUpdate = transactWrite.mock.calls[0][0].TransactItems[4]?.Update;
    expect(cancelUpdate?.UpdateExpression).toContain('reminderStatus = :cancelled');
    expect(cancelUpdate?.ExpressionAttributeValues?.[':cancelled']).toBe('cancelled');
    transactWrite.mockRestore();
  });

  it('recordReminderOutcome sets failureReason for failed outcome', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.recordReminderOutcome({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'failed',
      reason: 'providerUnavailable',
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Put?.Item).toMatchObject({
      failureReason: 'providerUnavailable',
      reminderStatus: 'failed',
    });
    transactWrite.mockRestore();
  });

  it('recordReminderOutcome sets suppressedReason for suppressed outcome', async () => {
    const repo = new TaskRepository();
    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'LOOKUP',
      entityType: 'TaskLookup',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      taskSk: 'DUE#1#TASK#rtask-abc',
      reminderHistory: [],
    });
    jest.spyOn(repo, 'getReminderCurrent').mockResolvedValue({
      pk: 'TASK#rtask-abc',
      sk: 'REM#CURRENT',
      entityType: 'ReminderInstance',
      reminderRecordId: 'rem-1',
      runtimeTaskInstanceId: 'rtask-abc',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderStatus: 'scheduled',
      scheduledReminderAt: 1_700_000_360_000,
      reminderChannel: 'push',
      schedulerJobId: 'job-1',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite')
      .mockResolvedValue(undefined);

    await repo.recordReminderOutcome({
      runtimeTaskInstanceId: 'rtask-abc',
      outcome: 'suppressed',
      reason: 'quietHours',
    });

    expect(transactWrite.mock.calls[0][0].TransactItems[0].Put?.Item).toMatchObject({
      suppressedReason: 'quietHours',
      reminderStatus: 'suppressed',
    });
    transactWrite.mockRestore();
  });
});