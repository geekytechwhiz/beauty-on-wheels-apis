import type { APIGatewayProxyEvent } from 'aws-lambda';
import { bearerToken, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  return {
    withApiHandler:
      (options: { validator?: (req: unknown) => void | Promise<void> }, handler: (req: unknown) => Promise<unknown>) =>
      async (event: APIGatewayProxyEvent) => {
        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event,
          params: event?.queryStringParameters ?? {},
          body: undefined,
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
          if (options?.validator) {
            await options.validator(req);
          }
          const out = await handler(req);
          return ApiResponse.ok(
            out,
            { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' },
            { correlationId: 'test-correlation-id' },
          );
        } catch (e: unknown) {
          const err = e as { statusCode?: number; code?: string; message?: string };
          const statusCode = err?.statusCode ?? 500;
          const code = err?.code ?? 'INTERNAL_ERROR';
          return ApiResponse.error(
            statusCode,
            { title: code, description: err?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code },
          );
        }
      },
  };
});

// eslint-disable-next-line no-var
var mockListPatientTasks: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockListPatientTasks = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      listPatientTasks: mockListPatientTasks,
    })),
  };
});

import { main } from './getTasks';

function baseListEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/tasks',
    pathParameters: null,
    queryStringParameters: { patientId: 'pat-1' },
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

describe('getTasks HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with paginated tasks on success', async () => {
    mockListPatientTasks.mockResolvedValue({
      items: [{ runtimeTaskInstanceId: 'rtask-1', surfaceSection: 'today' }],
    });

    const res = await main(baseListEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items).toHaveLength(1);
    expect(mockListPatientTasks).toHaveBeenCalledWith({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: undefined,
      workflowStage: undefined,
      currentState: undefined,
      surfaceSection: undefined,
      pageSize: 50,
      nextToken: undefined,
    });
  });

  it('returns 400 when patientId is missing', async () => {
    const res = await main(
      baseListEvent({ queryStringParameters: {} }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(400);
    expect(mockListPatientTasks).not.toHaveBeenCalled();
  });

  it('returns 401 when org missing from token', async () => {
    const res = await main(
      baseListEvent({
        headers: {
          Authorization: bearerToken({ 'custom:userID': 'user-1' }),
        },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('parses optional query filters', async () => {
    mockListPatientTasks.mockResolvedValue({ items: [] });

    await main(
      baseListEvent({
        queryStringParameters: {
          patientId: 'pat-1',
          carePlanInstanceId: 'cp-1',
          workflowStage: 'ongoing',
          currentState: 'active',
          surfaceSection: 'today',
          pageSize: '10',
        },
      }),
      testLambdaContext(),
    );

    expect(mockListPatientTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        carePlanInstanceId: 'cp-1',
        workflowStage: 'ongoing',
        currentState: 'active',
        surfaceSection: 'today',
        pageSize: 10,
      }),
    );
  });
});
