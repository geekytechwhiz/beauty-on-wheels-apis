import type { APIGatewayProxyEvent } from 'aws-lambda';
import { authHeaders, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  return createWithApiHandlerMock();
});

// eslint-disable-next-line no-var
var mockGetById: jest.Mock;

jest.mock('../../controllers/enablement-http.controller', () => {
  mockGetById = jest.fn();
  return {
    getEnablementHttpController: () => ({ handleGetEnablement: mockGetById }),
  };
});

import { main } from './getOrgEnablementById';

describe('getOrgEnablementById handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockGetById.mockReset();
  });

  it('returns 200 with enablement dto', async () => {
    mockGetById.mockResolvedValue({
      enablementId: 'ENB-1',
      organizationId: 'org-1',
      masterTemplateVersionId: 'CP-HTN-001-V01',
      effectiveFrom: '2024-04-01T00:00:00Z',
      createdAt: '2024-04-01T00:00:00Z',
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/org-enablements/id/ENB-1',
        pathParameters: { enablementId: 'ENB-1' },
        headers: authHeaders(),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.enablementId).toBe('ENB-1');
  });
});
