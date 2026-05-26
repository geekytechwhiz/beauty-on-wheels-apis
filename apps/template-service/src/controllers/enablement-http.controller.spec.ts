import type { LambdaRequest } from '@api-hub/utils';

import { bearerToken } from '../__tests__/handler-test-utils';
import { HTTP_NO_CONTENT } from '../utils/api-handler.util';
import { EnablementHttpController } from './enablement-http.controller';

const mockCreateOrgEnablement = jest.fn();
const mockSearchOrgEnablements = jest.fn();
const mockListOrgEnablementsByOrg = jest.fn();
const mockGetOrgEnablementById = jest.fn();
const mockUpdateOrgEnablement = jest.fn();

jest.mock('@api-hub/template-core', () => {
  const actual = jest.requireActual<typeof import('@api-hub/template-core')>('@api-hub/template-core');
  return {
    ...actual,
    EnablementService: jest.fn().mockImplementation(() => ({
      createOrgEnablement: mockCreateOrgEnablement,
      searchOrgEnablements: mockSearchOrgEnablements,
      listOrgEnablementsByOrg: mockListOrgEnablementsByOrg,
      getOrgEnablementById: mockGetOrgEnablementById,
      updateOrgEnablement: mockUpdateOrgEnablement,
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
    mockSearchOrgEnablements.mockReset();
    mockListOrgEnablementsByOrg.mockReset();
    mockGetOrgEnablementById.mockReset();
    mockUpdateOrgEnablement.mockReset();
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

  it('handleSearchEnablements returns list', async () => {
    mockSearchOrgEnablements.mockResolvedValue({ items: [{ enablementId: 'ENB-1' }] });

    const c = new EnablementHttpController();
    const out = await c.handleSearchEnablements(
      baseReq({
        validatedSearchEnablements: {
          query: { organizationId: 'org-1' },
          actorUserId: 'user-1',
        },
      } as unknown as import('@api-hub/utils').LambdaRequest),
    );

    expect(out.items).toHaveLength(1);
  });

  it('handlePatchEnablement returns HTTP_NO_CONTENT on revoke', async () => {
    mockUpdateOrgEnablement.mockResolvedValue(null);

    const c = new EnablementHttpController();
    const out = await c.handlePatchEnablement(
      baseReq({
        validatedPatchEnablement: {
          enablementId: 'ENB-1',
          body: { action: 'REVOKE' },
          actorUserId: 'user-1',
        },
      } as unknown as import('@api-hub/utils').LambdaRequest),
    );

    expect(out).toBe(HTTP_NO_CONTENT);
  });
});
