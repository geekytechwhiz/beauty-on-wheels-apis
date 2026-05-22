import type { APIGatewayProxyEvent } from 'aws-lambda';
import { authHeaders, setupHandlerTestEnv, testLambdaContext } from '../../__tests__/handler-test-utils';

jest.mock('@api-hub/middleware', () => {
  const { createWithApiHandlerMock } = require('../../__tests__/handler-test-utils');
  return createWithApiHandlerMock();
});

// eslint-disable-next-line no-var
var mockUpdateMasterVersion: jest.Mock;

jest.mock('../../controllers/template-http.controller', () => {
  mockUpdateMasterVersion = jest.fn();
  return {
    getTemplateHttpController: () => ({
      handleUpdateMasterVersion: mockUpdateMasterVersion,
    }),
  };
});

import { main } from './updateMasterTemplateVersion';

describe('updateMasterTemplateVersion handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockUpdateMasterVersion.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'PUT',
        path: '/dev/templates/master/CP-HTN-001/versions/V01',
        pathParameters: { templateId: 'CP-HTN-001', versionId: 'V01' },
        headers: {},
        body: JSON.stringify({ meta: { templateName: 'Updated' } }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockUpdateMasterVersion).not.toHaveBeenCalled();
  });

  it('returns 200 with summary on success', async () => {
    mockUpdateMasterVersion.mockResolvedValue({
      templateId: 'CP-HTN-001',
      templateVersionId: 'CP-HTN-001-V02',
      version: 2,
      status: 'DRAFT',
    });

    const result = await main(
      {
        httpMethod: 'PUT',
        path: '/dev/templates/master/CP-HTN-001/versions/V01',
        pathParameters: { templateId: 'CP-HTN-001', versionId: 'V01' },
        headers: authHeaders('ROOT', 'user-1'),
        body: JSON.stringify({ meta: { templateName: 'Updated Plan' } }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.templateVersionId).toBe('CP-HTN-001-V02');
    expect(mockUpdateMasterVersion).toHaveBeenCalledTimes(1);
  });
});
