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
          params: {},
          body: event?.body ? JSON.parse(event.body) : undefined,
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
          if (options?.validator) await options.validator(req);
          const out = await handler(req);
          return ApiResponse.ok(out, { title: 'OK', description: 'ok', severity: 'SUCCESS' }, { correlationId: 'c' });
        } catch (e: unknown) {
          const err = e as { statusCode?: number; code?: string; message?: string };
          return ApiResponse.error(
            err?.statusCode ?? 500,
            { title: err?.code ?? 'ERR', description: err?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'c' },
            { code: err?.code },
          );
        }
      },
  };
});

// eslint-disable-next-line no-var
var mockGenerateCarePlanTasks: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockGenerateCarePlanTasks = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      generateCarePlanTasks: mockGenerateCarePlanTasks,
    })),
  };
});

import { main } from './generateCarePlanTasks';

const validBody = {
  patientId: 'pat-1',
  patientDisplayName: 'Jane Doe',
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

function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/dev/tasks/care-plan/generate',
    pathParameters: null,
    queryStringParameters: null,
    headers: { Authorization: bearerToken({ 'custom:organizationID': 'org-1' }) },
    body: JSON.stringify(validBody),
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('generateCarePlanTasks HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());

  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with generation results', async () => {
    mockGenerateCarePlanTasks.mockResolvedValue({ results: [] });
    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    expect(mockGenerateCarePlanTasks).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when org missing from token', async () => {
    const res = await main(
      baseEvent({ headers: { Authorization: bearerToken({ sub: 'u1' }) } }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(401);
  });
});
