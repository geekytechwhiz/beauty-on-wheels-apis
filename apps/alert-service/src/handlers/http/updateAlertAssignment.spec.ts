import type { APIGatewayProxyEvent } from 'aws-lambda';

import {
  bearerToken,
  minimalAlertRecord,
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
        if (event?.source === 'serverless-plugin-warmup') {
          return ApiResponse.ok(null, { title: 'SUCCESS', description: 'Warmup', severity: 'SUCCESS' }, { correlationId: 'unknown' });
        }

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
          return ApiResponse.ok(out, { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' }, { correlationId: 'test-correlation-id' });
        } catch (e: any) {
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
var mockApplyAssignment: jest.Mock;

jest.mock('@api-hub/alert-core', () => {
  mockApplyAssignment = jest.fn();
  const actual = jest.requireActual<typeof import('@api-hub/alert-core')>('@api-hub/alert-core');
  return {
    ...actual,
    AlertService: jest.fn().mockImplementation(() => ({
      applyAssignment: mockApplyAssignment,
    })),
  };
});

import { main } from './updateAlertAssignment';

describe('updateAlertAssignment HTTP handler', () => {
  let envCleanup: () => void;

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());
  beforeEach(() => mockApplyAssignment.mockReset());

  const context = testLambdaContext();
  const alertId = minimalAlertRecord().alertId;

  function baseEvent(body: Record<string, unknown>, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: `/dev/alerts/assignment`,
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
      body: JSON.stringify({ performedByDisplayName: 'User One', ...body }),
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 200 with alertIds for single-select', async () => {
    mockApplyAssignment.mockResolvedValue({});

    const result = await (main as any)(
      baseEvent({ alertIds: [alertId], action: 'ASSIGN', assignToUserId: 'user-2', assigneeDisplayName: 'User Two' }),
      context,
    );

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body ?? '{}') as { success: boolean; data: { alertIds: string[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.alertIds).toEqual([alertId]);
    expect(mockApplyAssignment).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        alertIds: [alertId],
        action: 'ASSIGN',
        assignToUserId: 'user-2',
      }),
    );
  });

  it('derives assignToUserId for ASSIGN_TO_SELF from token', async () => {
    mockApplyAssignment.mockResolvedValue({});

    await (main as any)(baseEvent({ alertIds: [alertId], action: 'ASSIGN_TO_SELF', assigneeDisplayName: 'User One' }), context);

    expect(mockApplyAssignment).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        action: 'ASSIGN_TO_SELF',
        assignToUserId: 'user-1',
      }),
    );
  });

  it('returns 422 when assignToUserId missing for ASSIGN', async () => {
    const result = await (main as any)(baseEvent({ alertIds: [alertId], action: 'ASSIGN', assigneeDisplayName: 'User Two' }), context);
    expect(result.statusCode).toBe(422);
    expect(mockApplyAssignment).not.toHaveBeenCalled();
  });

  it('handles serverless-plugin-warmup', async () => {
    const warmup = { source: 'serverless-plugin-warmup' } as unknown as APIGatewayProxyEvent;
    const result = await (main as any)(warmup, context);
    expect(result.statusCode).toBe(200);
    expect(mockApplyAssignment).not.toHaveBeenCalled();
  });
});

