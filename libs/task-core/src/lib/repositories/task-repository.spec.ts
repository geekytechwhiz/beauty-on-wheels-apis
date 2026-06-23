import { CARE_PLAN_LSI_INDEX, STAFF_TASKS_GSI_INDEX } from '../constants/task.constants';
import { ASSIGNED_TO_TYPE } from '../models/types/task-domain.types';
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
      ':terminalMissed': 'missed',
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
          ':gsi1pk': TaskKeyBuilder.buildGsi1Pk('org-1', ASSIGNED_TO_TYPE.ORG_STAFF, 'staff-1'),
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
      currentState: 'open' as const,
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
      fromState: 'open',
      toState: 'completed',
      expectedPersistedState: 'open',
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

  it('appends scheduled reminderHistory and optional HIST audit', async () => {
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
    const meta = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: lookup.taskSk,
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
      currentState: 'open' as const,
      createdAt: 1,
      createdBy: 'system',
      lastUpdatedAt: 1,
      lastUpdatedBy: 'system',
      version: 1,
    };

    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(lookup);
    jest.spyOn(repo, 'getMetaByLookup').mockResolvedValue(meta);

    const result = await repo.recordReminderRegistered({
      runtimeTaskInstanceId: 'rtask-abc',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
      schedulerJobId: 'task-reminder-rtask-abc',
    });

    expect(result).toEqual({ written: true });
    const items = transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Update?.ExpressionAttributeValues?.[':reminderHistory']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reminderStatus: 'scheduled',
          schedulerJobId: 'task-reminder-rtask-abc',
          scheduledReminderAt: 1_700_000_360_000,
          reminderChannel: 'push',
        }),
      ]),
    );
    expect(items[1].Put?.Item).toMatchObject({
      historyEventType: 'reminderRegisterRequest',
      schedulerJobId: 'task-reminder-rtask-abc',
    });

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
    const meta = {
      pk: 'ORG#org-1#PAT#pat-1',
      sk: lookup.taskSk,
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
      currentState: 'open' as const,
      createdAt: 1,
      createdBy: 'system',
      lastUpdatedAt: 1,
      lastUpdatedBy: 'system',
      version: 1,
    };

    jest.spyOn(repo, 'getLookupByTaskId').mockResolvedValue(lookup);
    jest.spyOn(repo, 'getMetaByLookup').mockResolvedValue(meta);

    const result = await repo.recordReminderCancelled({
      runtimeTaskInstanceId: 'rtask-abc',
      reason: 'remindersDisabled',
    });

    expect(result).toEqual({ written: true });
    const history = transactWrite.mock.calls[0][0].TransactItems[0].Update
      ?.ExpressionAttributeValues?.[':reminderHistory'] as Array<{ reminderStatus: string }>;
    expect(history).toHaveLength(2);
    expect(history[1].reminderStatus).toBe('cancelled');

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
    currentState: 'open',
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
    currentState: 'open',
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
