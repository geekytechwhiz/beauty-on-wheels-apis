import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  bearerToken,
  minimalCreateMasterBody,
  minimalMasterTemplateRecord,
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
      (options: { bodySchema?: { parse: (b: unknown) => unknown }; validator?: (req: unknown) => Promise<void> }, handler: (req: unknown) => Promise<unknown>) =>
      async (event: APIGatewayProxyEvent) => {
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
        } catch (e: unknown) {
          const err = e as { name?: string; statusCode?: number; code?: string; message?: string };
          if (err?.name === 'ZodError') {
            return ApiResponse.unprocessableEntity(
              { title: 'VALIDATION_ERROR', description: 'Validation failed', severity: 'ERROR' },
              { correlationId: 'test-correlation-id' },
              { code: 'VALIDATION_ERROR' },
            );
          }
          return ApiResponse.error(
            err?.statusCode ?? 500,
            { title: err?.code ?? 'INTERNAL_ERROR', description: err?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code: err?.code ?? 'INTERNAL_ERROR' },
          );
        }
      },
  };
});

const mockCreateMaster = jest.fn();

jest.mock('../../controllers/template-http.controller', () => ({
  getTemplateHttpController: () => ({
    handleCreateMaster: mockCreateMaster,
  }),
}));

import { main } from './createMasterTemplate';

describe('createMasterTemplate handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockCreateMaster.mockReset();
  });

  it('returns 401 when user id missing from token', async () => {
    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/master',
        headers: { Authorization: bearerToken({ sub: 'anon' }) },
        body: JSON.stringify(minimalCreateMasterBody()),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockCreateMaster).not.toHaveBeenCalled();
  });

  it('returns 422 when body invalid', async () => {
    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/master',
        headers: {
          Authorization: bearerToken({
            'custom:organizationID': 'org-1',
            'custom:userID': 'user-1',
          }),
        },
        body: JSON.stringify({ templateCode: 'X' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(422);
    expect(mockCreateMaster).not.toHaveBeenCalled();
  });

  it('returns 200 with template summary on success', async () => {
    const record = minimalMasterTemplateRecord();
    mockCreateMaster.mockResolvedValue({
      templateId: record.meta.templateId,
      templateVersionId: record.meta.templateVersionId,
      version: 1,
      status: 'DRAFT',
      createdAt: record.meta.createdAt,
    });

    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/master',
        headers: {
          Authorization: bearerToken({
            'custom:organizationID': 'org-1',
            'custom:userID': 'user-1',
          }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(minimalCreateMasterBody()),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data.templateId).toBe('CP-HTN-001');
    expect(mockCreateMaster).toHaveBeenCalledTimes(1);
  });
});
