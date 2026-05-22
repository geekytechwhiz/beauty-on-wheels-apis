import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  authHeaders,
  setupHandlerTestEnv,
  testLambdaContext,
} from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  return createWithApiHandlerMock();
});

// eslint-disable-next-line no-var
var mockListOrg: jest.Mock;

jest.mock('../../controllers/org-template-http.controller', () => {
  mockListOrg = jest.fn();
  return {
    getOrgTemplateHttpController: () => ({
      handleListOrg: mockListOrg,
    }),
  };
});

import { main } from './listOrgTemplates';

describe('listOrgTemplates handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockListOrg.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/org',
        headers: {},
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockListOrg).not.toHaveBeenCalled();
  });

  it('returns 200 with org template list', async () => {
    mockListOrg.mockResolvedValue({
      items: [{ templateId: 'CP-ORG-001', status: 'DRAFT' }],
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/org',
        queryStringParameters: { status: 'DRAFT' },
        headers: authHeaders('org-1'),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.items).toHaveLength(1);
    expect(mockListOrg).toHaveBeenCalledTimes(1);
  });
});
