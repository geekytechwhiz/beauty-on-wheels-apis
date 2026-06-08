import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/middleware';
import {
  bearerToken,
  minimalTaskMetaRecord,
  setupHandlerTestEnv,
} from '../__tests__/handler-test-utils';

// eslint-disable-next-line no-var
var mockCreateMonitoringAction: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockCreateMonitoringAction = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      createMonitoringAction: mockCreateMonitoringAction,
    })),
  };
});

import { TaskHttpController } from './task-http.controller';

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
  });

  it('handleCreateMonitoringAction throws 500 when logger missing', async () => {
    const c = new TaskHttpController();
    const req = baseReq({
      context: {
        correlationId: 'c1',
        awsRequestId: 'a1',
        logger: undefined as unknown as any,
        authHeader: bearerToken({ 'custom:organizationID': 'org-1' }),
      },
    });

    await expect(c.handleCreateMonitoringAction(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockCreateMonitoringAction).not.toHaveBeenCalled();
  });

  it('handleCreateMonitoringAction throws 500 when validatedCreateMonitoringAction missing', async () => {
    const c = new TaskHttpController();
    const req = baseReq();

    await expect(c.handleCreateMonitoringAction(req)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(mockCreateMonitoringAction).not.toHaveBeenCalled();
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
          carePlanInstanceId: 'cp-1',
          monitoringInstanceId: 'mon-1',
          taskBehaviorCode: 'METRIC_CHECKIN',
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
        surfaceSection: expect.any(String),
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
          carePlanInstanceId: 'cp-1',
          monitoringInstanceId: 'mon-1',
          taskBehaviorCode: 'METRIC_CHECKIN',
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
});
