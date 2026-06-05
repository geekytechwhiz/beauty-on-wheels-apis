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
var mockCloneToOrg: jest.Mock;

jest.mock('../../controllers/org-template-http.controller', () => {
  mockCloneToOrg = jest.fn();
  return {
    getOrgTemplateHttpController: () => ({
      handleCloneToOrg: mockCloneToOrg,
    }),
  };
});

import { main } from './cloneOrgTemplate';

describe('cloneOrgTemplate handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockCloneToOrg.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/organizations/org-1/CP-HTN-001/versions/V01/clone',
        pathParameters: {
          organizationId: 'org-1',
          templateId: 'CP-HTN-001',
          versionId: 'V01',
        },
        headers: {},
        body: JSON.stringify({ newTemplateName: 'Org Copy' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockCloneToOrg).not.toHaveBeenCalled();
  });

  it('returns 200 with cloned template summary', async () => {
    mockCloneToOrg.mockResolvedValue({
      templateId: 'CP-ORG-001',
      templateVersionId: 'CP-ORG-001-V01',
      version: 1,
      status: 'DRAFT',
    });

    const result = await main(
      {
        httpMethod: 'POST',
        path: '/dev/templates/organizations/org-1/CP-HTN-001/versions/V01/clone',
        pathParameters: {
          organizationId: 'org-1',
          templateId: 'CP-HTN-001',
          versionId: 'V01',
        },
        headers: authHeaders('org-1'),
        body: JSON.stringify({ newTemplateName: 'Org Copy' }),
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.templateId).toBe('CP-ORG-001');
    expect(mockCloneToOrg).toHaveBeenCalledTimes(1);
  });
});
