import type { APIGatewayProxyEvent } from 'aws-lambda';
import { bearerToken, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  return {
    withApiHandler:
      (options: any, handler: (req: any) => Promise<any>) =>
      async (event: any) => {
        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event: any,
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

import { main } from './getAlertMetadata';

describe('getAlertMetadata HTTP handler', () => {
  let envCleanup: () => void;
  const context = testLambdaContext();

  beforeAll(() => {
    envCleanup = setupHandlerTestEnv().restore;
  });
  afterAll(() => envCleanup());

  function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'GET',
      path: '/dev/alerts/metadata',
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

  it('returns 200 with metadata lists', async () => {
    const result = await (main as any)(baseEvent(), context);
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body ?? '{}') as {
      success: boolean;
      data: { priorities: unknown[]; statuses: unknown[]; workflowActions: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.priorities)).toBe(true);
    expect(Array.isArray(body.data.statuses)).toBe(true);
    expect(Array.isArray(body.data.workflowActions)).toBe(true);
  });

  it('returns 401 when organization is missing from token', async () => {
    const result = await (main as any)(
      baseEvent({
        headers: { Authorization: bearerToken({ sub: 'user-only' }) },
      }),
      context,
    );
    expect(result.statusCode).toBe(401);
  });
});


