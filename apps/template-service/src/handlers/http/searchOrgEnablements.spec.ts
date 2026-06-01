import type { APIGatewayProxyEvent } from 'aws-lambda';
import { authHeaders, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  return createWithApiHandlerMock();
});

// eslint-disable-next-line no-var
var mockSearch: jest.Mock;

jest.mock('../../controllers/enablement-http.controller', () => {
  mockSearch = jest.fn();
  return {
    getEnablementHttpController: () => ({ handleSearchEnablements: mockSearch }),
  };
});

import { main } from './searchOrgEnablements';

describe('searchOrgEnablements handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockSearch.mockReset();
  });

  it('returns 422 when no search filters', async () => {
    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/org-enablements',
        headers: authHeaders('ROOT'),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns 200 with items', async () => {
    mockSearch.mockResolvedValue({ items: [{ enablementId: 'ENB-1' }] });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/org-enablements',
        queryStringParameters: { organizationId: 'ROOT' },
        headers: authHeaders('ROOT'),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });
});
