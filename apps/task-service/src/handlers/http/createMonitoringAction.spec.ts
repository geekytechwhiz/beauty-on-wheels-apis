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
var mockCreateMonitoringAction: jest.Mock;
// eslint-disable-next-line no-var
var mockGenerateCarePlanTasks: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockCreateMonitoringAction = jest.fn();
  mockGenerateCarePlanTasks = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      createMonitoringAction: mockCreateMonitoringAction,
      generateCarePlanTasks: mockGenerateCarePlanTasks,
    })),
  };
});

import { main } from './createMonitoringAction';
import { main as generateCarePlanTasksMain } from './generateCarePlanTasks';

describe('createMonitoringAction HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    envCleanup();
  });

  beforeEach(() => {
    mockCreateMonitoringAction.mockReset();
  });

  const DUE_START = Date.parse('2026-06-05T08:00:00.000Z');
  const DUE_END = Date.parse('2026-06-06T08:00:00.000Z');

  function validBody(): Record<string, unknown> {
    return {
      patientId: 'pat-1',
      patientDisplayName: 'Test Patient',
      carePlanInstanceId: 'cp-1',
      monitoringInstanceId: 'mon-1',
      taskBehaviorCode: 'METRIC_CHECKIN',
      dueWindowStart: DUE_START,
      dueWindowEnd: DUE_END,
    };
  }

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
      body: JSON.stringify(validBody()),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 Created with envelope on success', async () => {
    const record = minimalTaskMetaRecord();
    mockCreateMonitoringAction.mockResolvedValue({ record, outcome: 'created' });

    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      outcome: 'created',
    });
  });

  it('returns 200 SkippedDuplicate on same-org retry', async () => {
    const record = minimalTaskMetaRecord();
    mockCreateMonitoringAction.mockResolvedValue({ record, outcome: 'skippedDuplicate' });

    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.outcome).toBe('skippedDuplicate');
  });

  it('returns 401 when org missing from JWT', async () => {
    const res = await main(
      baseEvent({
        headers: {},
        body: JSON.stringify(validBody()),
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 422 on validation failure', async () => {
    const res = await main(
      baseEvent({
        body: JSON.stringify({ patientId: 'pat-1' }),
      }),
      testLambdaContext(),
    );
    expect(res.statusCode).toBe(422);
  });

  it('returns 409 on cross-org idempotency conflict', async () => {
    const err = new Error('This idempotency key is already in use') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'IDEMPOTENCY_KEY_IN_USE';
    mockCreateMonitoringAction.mockRejectedValue(err);

    const res = await main(baseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error?.code ?? body.code).toBeDefined();
  });
});

describe('generateCarePlanTasks HTTP handler', () => {
  beforeEach(() => {
    mockGenerateCarePlanTasks.mockReset();
  });

  const CP_DUE_START = Date.parse('2026-06-04T10:00:00.000Z');
  const CP_DUE_END = Date.parse('2026-06-04T22:00:00.000Z');

  function carePlanValidBody(): Record<string, unknown> {
    return {
      patientId: 'pat-1',
      patientDisplayName: 'Test Patient',
      carePlanInstanceId: 'cp-1',
      taskGenerationTrigger: 'carePlanStageEntered',
      workflowStage: 'onboarding',
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
            dueWindowStart: CP_DUE_START,
            dueWindowEnd: CP_DUE_END,
          },
        ],
      },
    };
  }

  function carePlanBaseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: '/dev/tasks/generate-care-plan',
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: JSON.stringify(carePlanValidBody()),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 with batch results on success', async () => {
    const record = minimalTaskMetaRecord({
      runtimeTaskSource: 'carePlanTaskLinkage',
      carePlanTaskLinkageId: 'link-1',
    });
    mockGenerateCarePlanTasks.mockResolvedValue({
      results: [
        {
          runtimeTaskInstanceId: record.runtimeTaskInstanceId,
          outcome: 'created',
          task: { runtimeTaskInstanceId: record.runtimeTaskInstanceId },
        },
      ],
    });

    const res = await generateCarePlanTasksMain(carePlanBaseEvent(), testLambdaContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.results[0]).toMatchObject({
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      outcome: 'created',
    });
  });

});
