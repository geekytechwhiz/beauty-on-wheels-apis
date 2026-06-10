import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
  minimalTaskMetaRecord,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  function tryParseJson(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    if (body.trim() === '') return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return Symbol.for('invalid-json');
    }
  }

  return {
    withApiHandler:
      (options: any, handler: (req: any) => Promise<any>) =>
      async (event: any) => {
        const parsedBody = tryParseJson(event?.body);
        if (parsedBody === Symbol.for('invalid-json')) {
          return ApiResponse.unprocessableEntity(
            { title: 'INVALID_JSON', description: 'Invalid JSON body', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code: 'INVALID_JSON' },
          );
        }

        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event,
          params: event?.queryStringParameters ?? {},
          body: parsedBody,
          query: {},
          pathParameters: event?.pathParameters ?? undefined,
          context: {
            correlationId: 'test-correlation-id',
            awsRequestId: 'test-aws-request-id',
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            authHeader,
          },
        };

        try {
          if (options?.bodySchema) {
            req.body = options.bodySchema.parse(req.body);
          }
          if (options?.validator) {
            await options.validator(req);
          }
          const out = await handler(req);
          return ApiResponse.ok(
            out,
            { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' },
            { correlationId: 'test-correlation-id' },
          );
        } catch (e: any) {
          if (e?.name === 'ZodError') {
            return ApiResponse.unprocessableEntity(
              {
                title: 'VALIDATION_ERROR',
                description: e?.issues?.[0]?.message ?? 'Validation failed',
                severity: 'ERROR',
              },
              { correlationId: 'test-correlation-id' },
              { code: 'VALIDATION_ERROR' },
            );
          }
          const statusCode = e?.statusCode ?? 500;
          const code = e?.code ?? 'INTERNAL_ERROR';
          return ApiResponse.error(
            statusCode,
            { title: code, description: e?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code },
          );
        }
      },
  };
});

// eslint-disable-next-line no-var
var mockCreateRuntimeTask: jest.Mock;
// eslint-disable-next-line no-var
var mockGetRuntimeTaskDetail: jest.Mock;
// eslint-disable-next-line no-var
var mockGetRuntimeTaskHistory: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockCreateRuntimeTask = jest.fn();
  mockGetRuntimeTaskDetail = jest.fn();
  mockGetRuntimeTaskHistory = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      createRuntimeTask: mockCreateRuntimeTask,
      getRuntimeTaskDetail: mockGetRuntimeTaskDetail,
      getRuntimeTaskHistory: mockGetRuntimeTaskHistory,
    })),
  };
});

import { main } from './createRuntimeTask';
import { main as getRuntimeTaskMain } from './getRuntimeTask';
import { main as getRuntimeTaskHistoryMain } from './getRuntimeTaskHistory';

describe('createRuntimeTask HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockCreateRuntimeTask.mockReset();
    mockGetRuntimeTaskDetail.mockReset();
  });

  function validStaffBody(): Record<string, unknown> {
    return {
      patientId: 'pat-1',
      patientDisplayName: 'Test Patient',
      runtimeTaskSource: 'manualSystem',
      taskBehaviorCode: 'CARE_TEAM_TASK',
      taskDisplayGroup: 'staffTask',
      displayTitle: 'Call patient',
      assignedToType: 'careTeam',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Lee',
      displayToPatient: false,
    };
  }

  function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: '/dev/tasks',
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: JSON.stringify(validStaffBody()),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 with envelope on success', async () => {
    const record = minimalTaskMetaRecord({
      runtimeTaskSource: 'manualSystem',
      taskDisplayGroup: 'staffTask',
      taskBehaviorCode: 'CARE_TEAM_TASK',
      assignedToType: 'careTeam',
      displayToPatient: false,
    });
    mockCreateRuntimeTask.mockResolvedValue({ record });

    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      task: expect.objectContaining({
        runtimeTaskSource: 'manualSystem',
        taskDisplayGroup: 'staffTask',
      }),
    });
    expect(body.data.outcome).toBeUndefined();
  });

  it('returns 401 when org missing from token', async () => {
    const res = await main(
      baseEvent({
        headers: {
          Authorization: bearerToken({ 'custom:userID': 'user-1' }),
        },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 422 when manualSystem and user missing from token', async () => {
    const res = await main(
      baseEvent({
        headers: {
          Authorization: bearerToken({ 'custom:organizationID': 'org-1' }),
        },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(422);
  });
});

describe('getRuntimeTask HTTP handler', () => {
  function baseGetEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'GET',
      path: '/dev/tasks/rtask-test-001',
      pathParameters: { runtimeTaskInstanceId: 'rtask-test-001' },
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

  it('returns 200 with task detail on success', async () => {
    const record = minimalTaskMetaRecord();
    mockGetRuntimeTaskDetail.mockResolvedValue({
      task: { runtimeTaskInstanceId: record.runtimeTaskInstanceId, orgId: 'org-1' },
      reminders: [],
      completionEvidence: [],
    });

    const res = await getRuntimeTaskMain(baseGetEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.task.runtimeTaskInstanceId).toBe(record.runtimeTaskInstanceId);
    expect(mockGetRuntimeTaskDetail).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-test-001',
      includeRelated: true,
    });
  });

  it('parses includeRelated=false', async () => {
    mockGetRuntimeTaskDetail.mockResolvedValue({
      task: { runtimeTaskInstanceId: 'rtask-test-001' },
    });

    const res = await getRuntimeTaskMain(
      baseGetEvent({ queryStringParameters: { includeRelated: 'false' } }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(200);
    expect(mockGetRuntimeTaskDetail).toHaveBeenCalledWith(
      expect.objectContaining({ includeRelated: false }),
    );
  });

  it('returns 401 when org missing from token', async () => {
    const res = await getRuntimeTaskMain(
      baseGetEvent({
        headers: {
          Authorization: bearerToken({ 'custom:userID': 'user-1' }),
        },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when service reports task not found', async () => {
    const err = new Error('Runtime task not found') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'TASK_NOT_FOUND';
    mockGetRuntimeTaskDetail.mockRejectedValue(err);

    const res = await getRuntimeTaskMain(baseGetEvent(), testLambdaContext());
    expect(res.statusCode).toBe(404);
  });
});

describe('getRuntimeTaskHistory HTTP handler', () => {
  function baseHistoryEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'GET',
      path: '/dev/tasks/rtask-test-001/history',
      pathParameters: { runtimeTaskInstanceId: 'rtask-test-001' },
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

  it('returns 200 with paged history on success', async () => {
    mockGetRuntimeTaskHistory.mockResolvedValue({
      items: [
        {
          taskStateHistoryId: 'hist-1',
          historyEventType: 'stateChange',
          transitionAt: 1780581600000,
          transitionBy: 'system:monitoring-runtime',
          transitionSource: 'system',
        },
      ],
    });

    const res = await getRuntimeTaskHistoryMain(baseHistoryEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(mockGetRuntimeTaskHistory).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runtimeTaskInstanceId: 'rtask-test-001',
      pageSize: 50,
      nextToken: undefined,
    });
  });

  it('parses pageSize and nextToken query params', async () => {
    mockGetRuntimeTaskHistory.mockResolvedValue({ items: [] });

    const res = await getRuntimeTaskHistoryMain(
      baseHistoryEvent({
        queryStringParameters: { pageSize: '25', nextToken: 'abc' },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(200);
    expect(mockGetRuntimeTaskHistory).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25, nextToken: 'abc' }),
    );
  });

  it('returns 401 when org missing from token', async () => {
    const res = await getRuntimeTaskHistoryMain(
      baseHistoryEvent({
        headers: {
          Authorization: bearerToken({ 'custom:userID': 'user-1' }),
        },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when service reports task not found', async () => {
    const err = new Error('Runtime task not found') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'TASK_NOT_FOUND';
    mockGetRuntimeTaskHistory.mockRejectedValue(err);

    const res = await getRuntimeTaskHistoryMain(baseHistoryEvent(), testLambdaContext());
    expect(res.statusCode).toBe(404);
  });
});
