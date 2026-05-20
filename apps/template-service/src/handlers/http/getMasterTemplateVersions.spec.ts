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
          params: { ...(event?.pathParameters ?? {}), ...(event?.queryStringParameters ?? {}) },
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
var mockGetMasterVersions: jest.Mock;

jest.mock('../../controllers/template-http.controller', () => {
  mockGetMasterVersions = jest.fn();
  return {
    getTemplateHttpController: () => ({
      handleGetMasterVersions: mockGetMasterVersions,
    }),
  };
});

import { main } from './getMasterTemplateVersions';

describe('getMasterTemplateVersions handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockGetMasterVersions.mockReset();
  });

  it('returns 200 with version list on success', async () => {
    mockGetMasterVersions.mockResolvedValue({
      items: [
        {
          templateId: 'CP-HTN-STANDARD',
          templateVersionId: 'CP-HTN-STANDARD-V01',
          organizationId: null,
          version: 1,
          status: 'DRAFT',
          isActive: true,
        },
      ],
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/master/CP-HTN-STANDARD/versions',
        pathParameters: { templateId: 'CP-HTN-STANDARD' },
        queryStringParameters: { status: 'DRAFT' },
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
    expect(mockGetMasterVersions).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with single version when version query set', async () => {
    mockGetMasterVersions.mockResolvedValue({
      pk: 'MASTER_TMPL#CP-HTN-STANDARD',
      sk: 'VERSION#001',
      entityType: 'MASTER_TEMPLATE',
      meta: { templateId: 'CP-HTN-STANDARD', templateVersionId: 'CP-HTN-STANDARD-V01', version: 1, status: 'DRAFT' },
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/master/CP-HTN-STANDARD/versions',
        pathParameters: { templateId: 'CP-HTN-STANDARD' },
        queryStringParameters: { version: 'V01' },
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
    expect(body.data.sk).toBe('VERSION#001');
    expect(mockGetMasterVersions).toHaveBeenCalledTimes(1);
  });
});
