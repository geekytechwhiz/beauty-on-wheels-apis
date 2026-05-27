import type { APIGatewayProxyEvent } from 'aws-lambda';
import { authHeaders, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  return createWithApiHandlerMock();
});

// eslint-disable-next-line no-var
var mockListByOrg: jest.Mock;

jest.mock('../../controllers/enablement-http.controller', () => {
  mockListByOrg = jest.fn();
  return {
    getEnablementHttpController: () => ({ handleListEnablementsByOrg: mockListByOrg }),
  };
});

import { main } from './listOrgEnablementsByOrg';

describe('listOrgEnablementsByOrg handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockListByOrg.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/org-enablements/org-1',
        pathParameters: { orgId: 'org-1' },
        headers: {},
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockListByOrg).not.toHaveBeenCalled();
  });

  it('returns 200 with items', async () => {
    mockListByOrg.mockResolvedValue({ items: [{ enablementId: 'ENB-1' }] });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/org-enablements/org-1',
        pathParameters: { orgId: 'org-1' },
        headers: authHeaders('org-1'),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    expect(mockListByOrg).toHaveBeenCalledTimes(1);
  });
});
