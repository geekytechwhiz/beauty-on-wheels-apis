import type { APIGatewayProxyEvent } from 'aws-lambda';
import { bearerToken, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  return {
    withApiHandler:
      (options: { validator?: (req: unknown) => Promise<void> }, handler: (req: unknown) => Promise<unknown>) =>
      async (event: APIGatewayProxyEvent) => {
        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event,
          params: event?.queryStringParameters ?? {},
          body: undefined,
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

// eslint-disable-next-line no-var
var mockListMaster: jest.Mock;

jest.mock('../../controllers/template-http.controller', () => {
  mockListMaster = jest.fn();
  return {
    getTemplateHttpController: () => ({
      handleListMaster: mockListMaster,
    }),
  };
});

import { main } from './listMasterTemplates';

describe('listMasterTemplates handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockListMaster.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/master',
        queryStringParameters: { status: 'DRAFT' },
        headers: {},
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockListMaster).not.toHaveBeenCalled();
  });

  it('returns 200 with items on success', async () => {
    mockListMaster.mockResolvedValue({
      items: [
        {
          templateId: 'CP-HTN-001',
          templateVersionId: 'CP-HTN-001-V01',
          templateName: 'Hypertension Management Plan',
          templateType: 'CARE_PLAN',
          version: 1,
          status: 'DRAFT',
          isActive: true,
        },
      ],
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/master',
        queryStringParameters: { status: 'DRAFT', templateType: 'CARE_PLAN' },
        headers: {
          Authorization: bearerToken({
            'custom:organizationID': 'org-1',
            'custom:userID': 'user-1',
          }),
        },
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].templateId).toBe('CP-HTN-001');
    expect(mockListMaster).toHaveBeenCalledTimes(1);
  });
});
