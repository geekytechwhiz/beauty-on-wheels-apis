import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/middleware';
import {
  bearerToken,
  minimalTaskMetaRecord,
  setupHandlerTestEnv,
} from '../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockCreateMonitoringAction: jest.Mock;
// eslint-disable-next-line no-var
var mockCreateRuntimeTask: jest.Mock;
// eslint-disable-next-line no-var
var mockGenerateCarePlanTasks: jest.Mock;
// eslint-disable-next-line no-var
var mockGetRuntimeTaskDetail: jest.Mock;
// eslint-disable-next-line no-var
var mockGetRuntimeTaskHistory: jest.Mock;
// eslint-disable-next-line no-var
var mockReassignAssignedStaff: jest.Mock;
// eslint-disable-next-line no-var
var mockListPatientTasks: jest.Mock;
// eslint-disable-next-line no-var
var mockListStaffTasks: jest.Mock;
// eslint-disable-next-line no-var
var mockListActionCenterItems: jest.Mock;
// eslint-disable-next-line no-var
var mockUpdateTaskState: jest.Mock;
// eslint-disable-next-line no-var
var mockGetTaskStatusSummaryByCarePlan: jest.Mock;
// eslint-disable-next-line no-var
var mockUpdateReminderSettings: jest.Mock;
// eslint-disable-next-line no-var
var mockUpdateRuntimeTask: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockCreateMonitoringAction = jest.fn();
  mockCreateRuntimeTask = jest.fn();
  mockGenerateCarePlanTasks = jest.fn();
  mockGetRuntimeTaskDetail = jest.fn();
  mockGetRuntimeTaskHistory = jest.fn();
  mockReassignAssignedStaff = jest.fn();
  mockListPatientTasks = jest.fn();
  mockListStaffTasks = jest.fn();
  mockListActionCenterItems = jest.fn();
  mockUpdateTaskState = jest.fn();
  mockGetTaskStatusSummaryByCarePlan = jest.fn();
  mockUpdateReminderSettings = jest.fn();
  mockUpdateRuntimeTask = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      createMonitoringAction: mockCreateMonitoringAction,
      createRuntimeTask: mockCreateRuntimeTask,
      generateCarePlanTasks: mockGenerateCarePlanTasks,
      getRuntimeTaskDetail: mockGetRuntimeTaskDetail,
      getRuntimeTaskHistory: mockGetRuntimeTaskHistory,
      listPatientTasks: mockListPatientTasks,
      listStaffTasks: mockListStaffTasks,
      listActionCenterItems: mockListActionCenterItems,
      reassignAssignedStaff: mockReassignAssignedStaff,
      updateTaskState: mockUpdateTaskState,
      getTaskStatusSummaryByCarePlan: mockGetTaskStatusSummaryByCarePlan,
      updateReminderSettings: mockUpdateReminderSettings,
      updateRuntimeTask: mockUpdateRuntimeTask,
    })),
  };
});

import { TaskHttpController, getTaskHttpController } from './task-http.controller';

function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/dev/tasks/monitoring-action',
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'user-1',
      }),
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function baseReq(overrides: Partial<LambdaRequest> = {}): LambdaRequest {
  const event = (overrides.event as APIGatewayProxyEvent | undefined) ?? baseEvent();
  return {
    event,
    params: {},
    body: undefined,
    query: {},
    pathParameters: event.pathParameters ?? undefined,
    context: {
      correlationId: 'test-correlation-id',
      awsRequestId: 'test-aws-request-id',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      authHeader: event.headers?.Authorization,
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

describe('TaskHttpController', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());

  beforeEach(() => {
    mockCreateMonitoringAction.mockReset();
    mockCreateRuntimeTask.mockReset();
    mockGenerateCarePlanTasks.mockReset();
    mockGetRuntimeTaskDetail.mockReset();
    mockGetRuntimeTaskHistory.mockReset();
    mockListPatientTasks.mockReset();
    mockReassignAssignedStaff.mockReset();
  });

  it('handleCreateMonitoringAction returns create result on success', async () => {
    const c = new TaskHttpController();
    const record = minimalTaskMetaRecord();
    mockCreateMonitoringAction.mockResolvedValue({ record, outcome: 'created' });

    const req = baseReq({
      validatedCreateMonitoringAction: {
        orgId: 'org-1',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          patientId: 'pat-1',
          patientDisplayName: 'Test Patient',
          carePlanInstanceId: 'cp-1',
          monitoringInstanceId: 'mon-1',
          taskBehaviorCode: 'METRIC_CHECKIN',
          assignedToType: 'patient',
          dueWindowStart: Date.parse('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: Date.parse('2026-06-06T08:00:00.000Z'),
        },
      },
    } as any);

    const out = await c.handleCreateMonitoringAction(req);
    expect(out).toMatchObject({
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      outcome: 'created',
      task: expect.objectContaining({
        orgId: 'org-1',
        patientId: 'pat-1',
        patientDisplayName: 'Test Patient',
        currentState: 'open',
      }),
    });
    expect(mockCreateMonitoringAction).toHaveBeenCalledTimes(1);
  });

  it('handleCreateMonitoringAction normalizes service errors (e.g. IDEMPOTENCY_KEY_IN_USE)', async () => {
    const c = new TaskHttpController();
    const err = new Error('This idempotency key is already in use') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'IDEMPOTENCY_KEY_IN_USE';
    mockCreateMonitoringAction.mockRejectedValue(err);

    const req = baseReq({
      validatedCreateMonitoringAction: {
        orgId: 'org-1',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          patientId: 'pat-1',
          patientDisplayName: 'Test Patient',
          carePlanInstanceId: 'cp-1',
          monitoringInstanceId: 'mon-1',
          taskBehaviorCode: 'METRIC_CHECKIN',
          assignedToType: 'patient',
          dueWindowStart: Date.parse('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: Date.parse('2026-06-06T08:00:00.000Z'),
        },
      },
    } as any);

    await expect(c.handleCreateMonitoringAction(req)).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_USE',
    });
  });

  it('handleCreateRuntimeTask returns create result on success', async () => {
    const c = new TaskHttpController();
    const record = minimalTaskMetaRecord({
      runtimeTaskSource: 'manualSystem',
      taskBehaviorCode: 'CARE_TEAM_TASK',
      taskDisplayGroup: 'staffTask',
      displayTitle: 'Call patient',
      assignedToType: 'orgStaff',
      displayToPatient: false,
      assignedToStaffId: 'staff-nurse-44721',
    });
    mockCreateRuntimeTask.mockResolvedValue({ record });

    const req = baseReq({
      validatedCreateRuntimeTask: {
        orgId: 'org-1',
        createdBy: 'user:user-1',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        body: {
          patientId: 'pat-1',
          patientDisplayName: 'Test Patient',
          runtimeTaskSource: 'manualSystem',
          taskBehaviorCode: 'CARE_TEAM_TASK',
          taskDisplayGroup: 'staffTask',
          displayTitle: 'Call patient',
          assignedToType: 'orgStaff',
          displayToPatient: false,
          assignedToStaffId: 'staff-nurse-44721',
          assignedToStaffDisplayName: 'Nurse Lee',
        },
      },
    } as any);

    const out = await c.handleCreateRuntimeTask(req);
    expect(out).toMatchObject({
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      task: expect.objectContaining({
        runtimeTaskSource: 'manualSystem',
        taskDisplayGroup: 'staffTask',
        currentState: 'open',
      }),
    });
    expect(out).not.toHaveProperty('outcome');
    expect(mockCreateRuntimeTask).toHaveBeenCalledTimes(1);
  });

  it('handleGetRuntimeTask returns task detail on success', async () => {
    const c = new TaskHttpController();
    const record = minimalTaskMetaRecord();
    const serviceResult = {
      task: {
        runtimeTaskInstanceId: record.runtimeTaskInstanceId,
        orgId: 'org-1',
        patientId: 'pat-1',
        patientDisplayName: 'Test Patient',
      },
      reminders: [],
      completionEvidence: [],
    };
    mockGetRuntimeTaskDetail.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGetRuntimeTask: {
        orgId: 'org-1',
        runtimeTaskInstanceId: record.runtimeTaskInstanceId,
        includeRelated: false,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    } as any);

    const out = await c.handleGetRuntimeTask(req);
    expect(out).toEqual(serviceResult);
    expect(mockGetRuntimeTaskDetail).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      includeRelated: false,
    });
  });

  it('handleGetRuntimeTaskHistory returns paged history on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      items: [
        {
          taskStateHistoryId: 'hist-1',
          historyEventType: 'stateChange',
          transitionAt: 1780581600000,
          transitionBy: 'system:monitoring-runtime',
          transitionSource: 'system',
        },
      ],
      nextToken: 'cursor-1',
    };
    mockGetRuntimeTaskHistory.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGetRuntimeTaskHistory: {
        orgId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        pageSize: 50,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    } as any);

    const out = await c.handleGetRuntimeTaskHistory(req);
    expect(out).toEqual(serviceResult);
    expect(mockGetRuntimeTaskHistory).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      pageSize: 50,
      nextToken: undefined,
    });
  });

  it('handleGetRuntimeTaskHistory throws 500 when validatedGetRuntimeTaskHistory missing', async () => {
    const c = new TaskHttpController();
    const req = baseReq();

    await expect(c.handleGetRuntimeTaskHistory(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockGetRuntimeTaskHistory).not.toHaveBeenCalled();
  });

  it('handleGenerateCarePlanTasks returns batch results on success', async () => {
    const c = new TaskHttpController();
    const record = minimalTaskMetaRecord({
      runtimeTaskSource: 'carePlanTaskLinkage',
      carePlanTaskLinkageId: 'link-1',
    });
    const serviceResult = {
      results: [
        {
          runtimeTaskInstanceId: record.runtimeTaskInstanceId,
          outcome: 'created' as const,
          task: { runtimeTaskInstanceId: record.runtimeTaskInstanceId },
        },
      ],
    };
    mockGenerateCarePlanTasks.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGenerateCarePlanTasks: {
        orgId: 'org-1',
        createdBy: 'system:care-plan-runtime:care-plan-runtime',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
        body: {
          patientId: 'pat-1',
          patientDisplayName: 'Test Patient',
          carePlanInstanceId: 'cp-1',
          taskGenerationTrigger: 'carePlanStageEntered',
          actorType: 'system',
          actorId: 'care-plan-runtime',
          sourceLinkageContext: {
            linkages: [
              {
                carePlanTaskLinkageId: 'link-1',
                taskBehaviorCode: 'EDUCATION_VIDEO',
                taskDisplayGroup: 'learning',
                displayTitle: 'Watch video',
                assignedToType: 'patient',
                displayToPatient: true,
                dueWindowStart: Date.parse('2026-06-04T10:00:00.000Z'),
                dueWindowEnd: Date.parse('2026-06-04T22:00:00.000Z'),
              },
            ],
          },
        },
      },
    } as any);

    const out = await c.handleGenerateCarePlanTasks(req);
    expect(out).toEqual(serviceResult);
    expect(mockGenerateCarePlanTasks).toHaveBeenCalledTimes(1);
  });

  it('handleGenerateCarePlanTasks throws 500 when validatedGenerateCarePlanTasks missing', async () => {
    const c = new TaskHttpController();
    const req = baseReq();

    await expect(c.handleGenerateCarePlanTasks(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockGenerateCarePlanTasks).not.toHaveBeenCalled();
  });

  it('handleGetTasks returns split patient/staff task list on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      patientId: 'pat-1',
      staffUserId: 'staff-1',
      patientTasks: { items: [{ runtimeTaskInstanceId: 'rtask-1', currentState: 'open' }] },
      staffTasks: { items: [] },
      nextToken: 'cursor-1',
    };
    mockListPatientTasks.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGetTasks: {
        orgId: 'org-1',
        patientId: 'pat-1',
        staffUserId: 'staff-1',
        carePlanInstanceId: 'cp-1',
        workflowStage: 'ongoing',
        currentState: 'open',
        pageSize: 25,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    } as any);

    const out = await c.handleGetTasks(req);
    expect(out).toEqual(serviceResult);
    expect(mockListPatientTasks).toHaveBeenCalledWith({
      organizationId: 'org-1',
      patientId: 'pat-1',
      staffUserId: 'staff-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'ongoing',
      currentState: 'open',
      pageSize: 25,
      nextToken: undefined,
    });
  });

  it('handleGetActionCenterItems returns grouped sections on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      patientId: 'pat-1',
      timezone: 'UTC',
      sections: {
        today: [{ runtimeTaskInstanceId: 'rtask-1', surfaceSection: 'today' }],
        upcoming: [],
        needsAttention: [],
        history: [],
        carePlanChecklist: [],
      },
      nextToken: undefined,
    };
    mockListActionCenterItems.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGetActionCenterItems: {
        orgId: 'org-1',
        patientId: 'pat-1',
        surfaceSection: 'all',
        timezone: 'UTC',
        pageSize: 50,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    } as any);

    const out = await c.handleGetActionCenterItems(req);
    expect(out).toEqual(serviceResult);
    expect(mockListActionCenterItems).toHaveBeenCalledWith({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: undefined,
      workflowStage: undefined,
      surfaceSection: 'all',
      timezone: 'UTC',
      pageSize: 50,
      nextToken: undefined,
    });
  });

  it('handleGetStaffTasks returns paginated staff inbox on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      items: [{ runtimeTaskInstanceId: 'rtask-staff-1', currentState: 'open' }],
      nextToken: 'cursor-1',
    };
    mockListStaffTasks.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGetStaffTasks: {
        orgId: 'org-1',
        staffUserId: 'staff-1',
        pageSize: 25,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'staff-1' }),
      },
    } as any);

    const out = await c.handleGetStaffTasks(req);
    expect(out).toEqual(serviceResult);
    expect(mockListStaffTasks).toHaveBeenCalledWith({
      organizationId: 'org-1',
      staffUserId: 'staff-1',
      patientId: undefined,
      carePlanInstanceId: undefined,
      currentState: undefined,
      pageSize: 25,
      nextToken: undefined,
    });
  });

  it('handleGetTasks throws 500 when validatedGetTasks missing', async () => {
    const c = new TaskHttpController();
    const req = baseReq();

    await expect(c.handleGetTasks(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockListPatientTasks).not.toHaveBeenCalled();
  });

  it('handleUpdateAssignedStaff returns reassignment result on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      runtimeTaskInstanceId: 'rtask-staff-1',
      task: { runtimeTaskInstanceId: 'rtask-staff-1', assignedToStaffId: 'staff-2' },
      historyEntry: { historyEventType: 'assignedToStaffChange', newAssignedToStaffId: 'staff-2' },
    };
    mockReassignAssignedStaff.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedUpdateAssignedStaff: {
        orgId: 'org-1',
        runtimeTaskInstanceId: 'rtask-staff-1',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          actorId: 'staff-manager-1',
          assignedToStaffId: 'staff-2',
          assignedToStaffDisplayName: 'Nurse Two',
          reason: 'Shift handoff',
        },
      },
    } as any);

    const out = await c.handleUpdateAssignedStaff(req);
    expect(out).toEqual(serviceResult);
    expect(mockReassignAssignedStaff).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-staff-1',
      actorId: 'staff-manager-1',
      assignedToStaffId: 'staff-2',
      assignedToStaffDisplayName: 'Nurse Two',
      reason: 'Shift handoff',
    });
  });

  it('handleUpdateTaskState returns state transition result on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      runtimeTaskInstanceId: 'rtask-abc',
      currentState: 'completed',
      surfaceSection: 'history',
      historyEntry: {
        historyEventType: 'stateChange',
        fromState: 'open',
        toState: 'completed',
      },
    };
    mockUpdateTaskState.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedUpdateTaskState: {
        orgId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          action: 'complete',
          actorId: 'pat-1',
          actorType: 'patient',
          expectedCurrentState: 'open',
          reason: 'Done',
        },
      },
    } as any);

    const out = await c.handleUpdateTaskState(req);
    expect(out).toEqual(serviceResult);
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        action: 'complete',
        actorId: 'pat-1',
        actorType: 'patient',
        expectedCurrentState: 'open',
        reason: 'Done',
        evidencePayload: undefined,
      },
      { correlationId: 'test-correlation-id' },
    );
  });

  it('handleUpdateReminderSettings returns updated settings on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      runtimeTaskInstanceId: 'rtask-abc',
      reminderEnabled: true,
      reminderSettings: { channels: ['push', 'inApp'] },
      historyEntry: { historyEventType: 'reminderSettingsChange', newReminderEnabled: true },
    };
    mockUpdateReminderSettings.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedUpdateReminderSettings: {
        orgId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          actorId: 'staff-1',
          reminderEnabled: true,
          reminderSettings: { channels: ['push', 'inApp'] },
          reason: 'Patient requested',
        },
      },
    } as any);

    const out = await c.handleUpdateReminderSettings(req);
    expect(out).toEqual(serviceResult);
    expect(mockUpdateReminderSettings).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        actorId: 'staff-1',
        reminderEnabled: true,
        reminderSettings: { channels: ['push', 'inApp'] },
        reason: 'Patient requested',
      },
      { correlationId: 'test-correlation-id' },
    );
  });

  it('handleGetTaskStatusSummary returns readiness summary on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      orgId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
      readinessStatus: 'ready',
      counts: {
        total: 2,
        requiredTotal: 2,
        completed: 2,
        missed: 0,
        active: 0,
        scheduled: 0,
      },
    };
    mockGetTaskStatusSummaryByCarePlan.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedGetTaskStatusSummary: {
        orgId: 'org-1',
        patientId: 'pat-1',
        carePlanInstanceId: 'cp-1',
        workflowStage: 'onboarding',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    } as any);

    const out = await c.handleGetTaskStatusSummary(req);
    expect(out).toEqual(serviceResult);
    expect(mockGetTaskStatusSummaryByCarePlan).toHaveBeenCalledWith({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
    });
  });

  it('handleUpdateRuntimeTask returns updated task on success', async () => {
    const c = new TaskHttpController();
    const serviceResult = {
      runtimeTaskInstanceId: 'rtask-abc',
      task: { displayTitle: 'Updated title' },
      historyEntry: { historyEventType: 'taskMetadataChange', changedFields: ['displayTitle'] },
    };
    mockUpdateRuntimeTask.mockResolvedValue(serviceResult);

    const req = baseReq({
      validatedUpdateRuntimeTask: {
        orgId: 'org-1',
        runtimeTaskInstanceId: 'rtask-abc',
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
        body: {
          actorId: 'staff-1',
          displayTitle: 'Updated title',
          reason: 'Portal edit',
        },
        patch: { displayTitle: 'Updated title' },
      },
    } as any);

    const out = await c.handleUpdateRuntimeTask(req);
    expect(out).toEqual(serviceResult);
    expect(mockUpdateRuntimeTask).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-abc',
      actorId: 'staff-1',
      reason: 'Portal edit',
      patch: { displayTitle: 'Updated title' },
    });
  });

  it('getTaskHttpController returns singleton controller', () => {
    const first = getTaskHttpController();
    const second = getTaskHttpController();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(TaskHttpController);
  });

  describe('logger missing guards', () => {
    const noLoggerContext = {
      correlationId: 'c1',
      awsRequestId: 'a1',
      logger: undefined as unknown as any,
      authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
    };

    it.each([
      ['handleCreateRuntimeTask', (c: TaskHttpController, req: LambdaRequest) => c.handleCreateRuntimeTask(req)],
      ['handleGetRuntimeTask', (c: TaskHttpController, req: LambdaRequest) => c.handleGetRuntimeTask(req)],
      ['handleUpdateAssignedStaff', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateAssignedStaff(req)],
      ['handleGetTasks', (c: TaskHttpController, req: LambdaRequest) => c.handleGetTasks(req)],
      ['handleGetStaffTasks', (c: TaskHttpController, req: LambdaRequest) => c.handleGetStaffTasks(req)],
      ['handleGetActionCenterItems', (c: TaskHttpController, req: LambdaRequest) => c.handleGetActionCenterItems(req)],
      ['handleGetRuntimeTaskHistory', (c: TaskHttpController, req: LambdaRequest) => c.handleGetRuntimeTaskHistory(req)],
      ['handleGenerateCarePlanTasks', (c: TaskHttpController, req: LambdaRequest) => c.handleGenerateCarePlanTasks(req)],
      ['handleUpdateTaskState', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateTaskState(req)],
      ['handleGetTaskStatusSummary', (c: TaskHttpController, req: LambdaRequest) => c.handleGetTaskStatusSummary(req)],
      ['handleUpdateRuntimeTask', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateRuntimeTask(req)],
      ['handleUpdateReminderSettings', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateReminderSettings(req)],
    ])('%s throws 500 when logger missing', async (_name, invoke) => {
      const c = new TaskHttpController();
      const req = baseReq({ context: noLoggerContext });
      await expect(invoke(c, req)).rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });

  describe('missing validated payload guards', () => {
    it('handleUpdateAssignedStaff throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleUpdateAssignedStaff(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('handleGetStaffTasks throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleGetStaffTasks(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('handleGetActionCenterItems throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleGetActionCenterItems(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('handleUpdateTaskState throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleUpdateTaskState(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('handleUpdateReminderSettings throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleUpdateReminderSettings(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('handleGetTaskStatusSummary throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleGetTaskStatusSummary(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('handleUpdateRuntimeTask throws when validated payload missing', async () => {
      const c = new TaskHttpController();
      await expect(c.handleUpdateRuntimeTask(baseReq())).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });
  });

  it('handleGetRuntimeTask propagates service errors', async () => {
    const c = new TaskHttpController();
    const err = Object.assign(new Error('Task not found'), { statusCode: 404, code: 'TASK_NOT_FOUND' });
    mockGetRuntimeTaskDetail.mockRejectedValue(err);

    const req = baseReq({
      validatedGetRuntimeTask: {
        orgId: 'org-1',
        runtimeTaskInstanceId: 'rtask-missing',
        includeRelated: true,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    } as any);

    await expect(c.handleGetRuntimeTask(req)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TASK_NOT_FOUND',
    });
  });

  it.each([
    ['handleCreateRuntimeTask', mockCreateRuntimeTask, 'validatedCreateRuntimeTask', (c: TaskHttpController, req: LambdaRequest) => c.handleCreateRuntimeTask(req)],
    ['handleUpdateAssignedStaff', mockReassignAssignedStaff, 'validatedUpdateAssignedStaff', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateAssignedStaff(req)],
    ['handleGetTasks', mockListPatientTasks, 'validatedGetTasks', (c: TaskHttpController, req: LambdaRequest) => c.handleGetTasks(req)],
    ['handleGetStaffTasks', mockListStaffTasks, 'validatedGetStaffTasks', (c: TaskHttpController, req: LambdaRequest) => c.handleGetStaffTasks(req)],
    ['handleGetActionCenterItems', mockListActionCenterItems, 'validatedGetActionCenterItems', (c: TaskHttpController, req: LambdaRequest) => c.handleGetActionCenterItems(req)],
    ['handleGetRuntimeTaskHistory', mockGetRuntimeTaskHistory, 'validatedGetRuntimeTaskHistory', (c: TaskHttpController, req: LambdaRequest) => c.handleGetRuntimeTaskHistory(req)],
    ['handleGenerateCarePlanTasks', mockGenerateCarePlanTasks, 'validatedGenerateCarePlanTasks', (c: TaskHttpController, req: LambdaRequest) => c.handleGenerateCarePlanTasks(req)],
    ['handleUpdateTaskState', mockUpdateTaskState, 'validatedUpdateTaskState', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateTaskState(req)],
    ['handleGetTaskStatusSummary', mockGetTaskStatusSummaryByCarePlan, 'validatedGetTaskStatusSummary', (c: TaskHttpController, req: LambdaRequest) => c.handleGetTaskStatusSummary(req)],
    ['handleUpdateRuntimeTask', mockUpdateRuntimeTask, 'validatedUpdateRuntimeTask', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateRuntimeTask(req)],
    ['handleUpdateReminderSettings', mockUpdateReminderSettings, 'validatedUpdateReminderSettings', (c: TaskHttpController, req: LambdaRequest) => c.handleUpdateReminderSettings(req)],
  ])('%s propagates service errors', async (_name, mockFn, validatedKey, invoke) => {
    const c = new TaskHttpController();
    const err = Object.assign(new Error('service failed'), { statusCode: 500, code: 'INTERNAL_ERROR' });
    mockFn.mockRejectedValue(err);
    const req = baseReq({
      [validatedKey]: { orgId: 'org-1', authHeader: bearerToken({ 'custom:organizationID': 'org-1' }) },
    } as any);
    await expect(invoke(c, req)).rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
  });
});
