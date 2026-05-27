import type { APIGatewayProxyEvent } from 'aws-lambda';
import { authHeaders, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';
jest.mock('@api-hub/middleware', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  return createWithApiHandlerMock();
});

jest.mock('../../utils/api-handler.util', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  const middleware = createWithApiHandlerMock();
  return {
    HTTP_NO_CONTENT: Symbol('HTTP_NO_CONTENT'),
    withApiHandlerOrNoContent: middleware.withApiHandler,
  };
});

// eslint-disable-next-line no-var
var mockPatch: jest.Mock;

jest.mock('../../controllers/enablement-http.controller', () => {
  mockPatch = jest.fn();
  return {
    getEnablementHttpController: () => ({ handlePatchEnablement: mockPatch }),
  };
});

import { main } from './updateOrgEnablement';

describe('updateOrgEnablement handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockPatch.mockReset();
  });

  it('returns 422 when UPDATE missing dates', async () => {
    const result = await main(
      {
        httpMethod: 'PATCH',
        path: '/dev/org-enablements/id/ENB-1',
        pathParameters: { enablementId: 'ENB-1' },
        headers: authHeaders('ROOT'),
        body: JSON.stringify({ action: 'UPDATE' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(422);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('invokes patch handler on REVOKE', async () => {
    mockPatch.mockResolvedValue({ enablementId: 'ENB-1' });

    await main(
      {
        httpMethod: 'PATCH',
        path: '/dev/org-enablements/id/ENB-1',
        pathParameters: { enablementId: 'ENB-1' },
        headers: authHeaders('ROOT'),
        body: JSON.stringify({ action: 'REVOKE' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  it('returns 200 on UPDATE success', async () => {
    mockPatch.mockResolvedValue({
      enablementId: 'ENB-1',
      effectiveTo: '2025-12-31T23:59:59Z',
    });

    const result = await main(
      {
        httpMethod: 'PATCH',
        path: '/dev/org-enablements/id/ENB-1',
        pathParameters: { enablementId: 'ENB-1' },
        headers: authHeaders('ROOT'),
        body: JSON.stringify({
          action: 'UPDATE',
          effectiveTo: '2025-12-31T23:59:59Z',
        }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});
