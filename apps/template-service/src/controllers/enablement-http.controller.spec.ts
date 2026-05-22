import type { LambdaRequest } from '@api-hub/utils';

import { bearerToken } from '../__tests__/handler-test-utils';
import { EnablementHttpController } from './enablement-http.controller';

const mockCreateOrgEnablement = jest.fn();

jest.mock('@api-hub/template-core', () => {
  const actual = jest.requireActual<typeof import('@api-hub/template-core')>('@api-hub/template-core');
  return {
    ...actual,
    EnablementService: jest.fn().mockImplementation(() => ({
      createOrgEnablement: mockCreateOrgEnablement,
    })),
  };
});

function baseReq(overrides: Partial<LambdaRequest & Record<string, unknown>> = {}): LambdaRequest {
  return {
    event: { headers: { Authorization: bearerToken({ 'custom:organizationID': 'ROOT', 'custom:userID': 'user-1' }) } },
    params: {},
    body: {},
    context: {
      correlationId: 'c1',
      awsRequestId: 'a1',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      authHeader: bearerToken({ 'custom:organizationID': 'ROOT', 'custom:userID': 'user-1' }),
    },
    ...overrides,
  } as LambdaRequest;
}

describe('EnablementHttpController', () => {
  beforeEach(() => {
    mockCreateOrgEnablement.mockReset();
  });

  it('handleCreateEnablement returns dto from service', async () => {
    mockCreateOrgEnablement.mockResolvedValue({
      enablementId: 'EN-org-1-abc',
      organizationId: 'org-1',
      masterTemplateVersionId: 'CP-HTN-001-V01',
    });

    const c = new EnablementHttpController();
    const out = await c.handleCreateEnablement(
      baseReq({
        validatedCreateEnablement: {
          body: {
            organizationId: 'org-1',
            masterTemplateVersionId: 'CP-HTN-001-V01',
          },
          actorUserId: 'user-1',
        },
      } as unknown as LambdaRequest),
    );

    expect(out.enablementId).toBe('EN-org-1-abc');
    expect(mockCreateOrgEnablement).toHaveBeenCalledWith({
      body: { organizationId: 'org-1', masterTemplateVersionId: 'CP-HTN-001-V01' },
      actorUserId: 'user-1',
    });
  });
});
