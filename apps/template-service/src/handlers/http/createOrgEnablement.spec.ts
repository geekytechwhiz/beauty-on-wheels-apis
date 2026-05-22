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
var mockCreateEnablement: jest.Mock;

jest.mock('../../controllers/enablement-http.controller', () => {
  mockCreateEnablement = jest.fn();
  return {
    getEnablementHttpController: () => ({
      handleCreateEnablement: mockCreateEnablement,
    }),
  };
});

import { main } from './createOrgEnablement';

describe('createOrgEnablement handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockCreateEnablement.mockReset();
  });

  it('returns 422 when body invalid', async () => {
    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/org-enablements',
        headers: authHeaders('ROOT'),
        body: JSON.stringify({ organizationId: 'org-1' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(422);
    expect(mockCreateEnablement).not.toHaveBeenCalled();
  });

  it('returns 200 with enablement dto on success', async () => {
    mockCreateEnablement.mockResolvedValue({
      enablementId: 'EN-org-1-abc',
      organizationId: 'org-1',
      masterTemplateVersionId: 'CP-HTN-001-V01',
      templateName: 'Hypertension Plan',
      condition: 'HYPERTENSION',
      effectiveFrom: '2024-04-01T00:00:00Z',
      effectiveTo: null,
      createdAt: '2024-04-01T00:00:00Z',
    });

    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/org-enablements',
        headers: authHeaders('ROOT'),
        body: JSON.stringify({
          organizationId: 'org-1',
          masterTemplateVersionId: 'CP-HTN-001-V01',
          effectiveFrom: '2024-04-01T00:00:00Z',
        }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.enablementId).toBe('EN-org-1-abc');
    expect(mockCreateEnablement).toHaveBeenCalledTimes(1);
  });
});
