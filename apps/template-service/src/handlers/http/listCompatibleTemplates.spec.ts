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
var mockListCompatible: jest.Mock;

jest.mock('../../controllers/template-http.controller', () => {
  mockListCompatible = jest.fn();
  return {
    getTemplateHttpController: () => ({
      handleListCompatible: mockListCompatible,
    }),
  };
});

import { main } from './listCompatibleTemplates';

describe('listCompatibleTemplates handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockListCompatible.mockReset();
  });

  it('returns 422 when condition missing', async () => {
    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/compatible',
        queryStringParameters: { country: 'IN' },
        headers: authHeaders(),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(422);
    expect(mockListCompatible).not.toHaveBeenCalled();
  });

  it('returns 200 with compatible items', async () => {
    mockListCompatible.mockResolvedValue({
      items: [
        {
          templateId: 'CP-HTN-001',
          templateVersionId: 'CP-HTN-001-V01',
          templateName: 'Hypertension Plan',
          condition: 'HYPERTENSION',
          countries: ['IN'],
          duration: 'MONTHS_6',
          status: 'PUBLISHED',
          publishedAt: '2024-04-01T00:00:00Z',
        },
      ],
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/compatible',
        queryStringParameters: {
          condition: 'HYPERTENSION',
          country: 'IN',
          duration: 'MONTHS_6',
        },
        headers: authHeaders(),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.items).toHaveLength(1);
    expect(mockListCompatible).toHaveBeenCalledTimes(1);
  });
});
