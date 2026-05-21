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
var mockUpdateOrgVersion: jest.Mock;

jest.mock('../../controllers/org-template-http.controller', () => {
  mockUpdateOrgVersion = jest.fn();
  return {
    getOrgTemplateHttpController: () => ({
      handleUpdateOrgVersion: mockUpdateOrgVersion,
    }),
  };
});

import { main } from './updateOrgTemplateVersion';

describe('updateOrgTemplateVersion handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockUpdateOrgVersion.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'PUT',
        path: '/dev/templates/org/CP-ORG-001/versions/V01',
        pathParameters: { templateId: 'CP-ORG-001', versionId: 'V01' },
        headers: {},
        body: JSON.stringify({ meta: { templateName: 'Org Updated' } }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockUpdateOrgVersion).not.toHaveBeenCalled();
  });

  it('returns 200 with summary on success', async () => {
    mockUpdateOrgVersion.mockResolvedValue({
      templateId: 'CP-ORG-001',
      templateVersionId: 'CP-ORG-001-V02',
      version: 2,
      status: 'DRAFT',
    });

    const result = await main(
      {
        httpMethod: 'PUT',
        path: '/dev/templates/org/CP-ORG-001/versions/V01',
        pathParameters: { templateId: 'CP-ORG-001', versionId: 'V01' },
        headers: authHeaders('org-1'),
        body: JSON.stringify({ meta: { templateName: 'Org Updated' } }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.version).toBe(2);
    expect(mockUpdateOrgVersion).toHaveBeenCalledTimes(1);
  });
});
