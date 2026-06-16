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
var mockListActionCenterItems: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockListActionCenterItems = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      listActionCenterItems: mockListActionCenterItems,
    })),
  };
});

import { main } from './getActionCenterItems';

function baseActionCenterEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/action-center/items',
    pathParameters: null,
    queryStringParameters: {
      patientId: 'pat-1',
      surfaceSection: 'all',
      timezone: 'UTC',
    },
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
      }),
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('getActionCenterItems HTTP handler', () => {
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

  it('returns 200 with grouped sections on success', async () => {
    mockListActionCenterItems.mockResolvedValue({
      patientId: 'pat-1',
      timezone: 'UTC',
      sections: {
        today: [{ runtimeTaskInstanceId: 'rtask-1', surfaceSection: 'today' }],
        upcoming: [],
        needsAttention: [],
        history: [],
        carePlanChecklist: [],
      },
    });

    const res = await main(baseActionCenterEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.sections.today).toHaveLength(1);
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

  it('returns 400 when patientId is missing', async () => {
    const res = await main(
      baseActionCenterEvent({
        queryStringParameters: { surfaceSection: 'all' },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(400);
    expect(mockListActionCenterItems).not.toHaveBeenCalled();
  });

  it('returns 400 when surfaceSection is invalid', async () => {
    const res = await main(
      baseActionCenterEvent({
        queryStringParameters: { patientId: 'pat-1', surfaceSection: 'invalid' },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(400);
    expect(mockListActionCenterItems).not.toHaveBeenCalled();
  });

  it('returns 400 when timezone is invalid', async () => {
    const res = await main(
      baseActionCenterEvent({
        queryStringParameters: {
          patientId: 'pat-1',
          surfaceSection: 'today',
          timezone: 'Not/A/Timezone',
        },
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(400);
    expect(mockListActionCenterItems).not.toHaveBeenCalled();
  });
});
