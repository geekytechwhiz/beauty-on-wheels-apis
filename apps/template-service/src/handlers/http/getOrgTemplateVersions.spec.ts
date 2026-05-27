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
var mockGetOrgVersions: jest.Mock;

jest.mock('../../controllers/org-template-http.controller', () => {
  mockGetOrgVersions = jest.fn();
  return {
    getOrgTemplateHttpController: () => ({
      handleGetOrgVersions: mockGetOrgVersions,
    }),
  };
});

import { main } from './getOrgTemplateVersions';

describe('getOrgTemplateVersions handler', () => {
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = setupHandlerTestEnv().restore;
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(() => {
    mockGetOrgVersions.mockReset();
  });

  it('returns 401 when user id missing', async () => {
    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/organizations/org-1/CP-ORG-001/versions',
        pathParameters: { organizationId: 'org-1', templateId: 'CP-ORG-001' },
        headers: {},
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(401);
    expect(mockGetOrgVersions).not.toHaveBeenCalled();
  });

  it('returns 200 with version list', async () => {
    mockGetOrgVersions.mockResolvedValue({
      items: [{ templateId: 'CP-ORG-001', version: 1, status: 'DRAFT' }],
    });

    const result = await main(
      {
        httpMethod: 'GET',
        path: '/dev/templates/organizations/org-1/CP-ORG-001/versions',
        pathParameters: { organizationId: 'org-1', templateId: 'CP-ORG-001' },
        headers: authHeaders('org-1'),
        body: null,
      } as unknown as APIGatewayProxyEvent,
      testLambdaContext(),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.items).toHaveLength(1);
    expect(mockGetOrgVersions).toHaveBeenCalledTimes(1);
  });
});
