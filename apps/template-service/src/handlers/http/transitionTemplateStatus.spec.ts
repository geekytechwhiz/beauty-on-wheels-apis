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
var mockStatusTransition: jest.Mock;

jest.mock('../../controllers/template-http.controller', () => {
  mockStatusTransition = jest.fn();
  return {
    getTemplateHttpController: () => ({
      handleStatusTransition: mockStatusTransition,
    }),
  };
});

import { main } from './transitionTemplateStatus';

describe('transitionTemplateStatus handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockStatusTransition.mockReset();
  });

  it('returns 422 when REJECT missing reason', async () => {
    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/CP-HTN-001/versions/V01/status',
        pathParameters: { templateId: 'CP-HTN-001', versionId: 'V01' },
        headers: authHeaders(),
        body: JSON.stringify({ action: 'REJECT' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(422);
    expect(mockStatusTransition).not.toHaveBeenCalled();
  });

  it('returns 200 on SUBMIT_REVIEW success', async () => {
    mockStatusTransition.mockResolvedValue({
      templateId: 'CP-HTN-001',
      templateVersionId: 'CP-HTN-001-V01',
      version: 1,
      status: 'IN_REVIEW',
    });

    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/CP-HTN-001/versions/V01/status',
        pathParameters: { templateId: 'CP-HTN-001', versionId: 'V01' },
        headers: authHeaders(),
        body: JSON.stringify({ action: 'SUBMIT_REVIEW', comment: 'Ready' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.status).toBe('IN_REVIEW');
    expect(mockStatusTransition).toHaveBeenCalledTimes(1);
  });
});
