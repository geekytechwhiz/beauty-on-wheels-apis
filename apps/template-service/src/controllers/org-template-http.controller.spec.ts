import type { LambdaRequest } from '@api-hub/utils';

import { bearerToken, minimalMasterTemplateRecord } from '../__tests__/handler-test-utils';
import { OrgTemplateHttpController } from './org-template-http.controller';

const mockCloneTemplateVersion = jest.fn();
const mockGetOrgTemplateVersions = jest.fn();
const mockUpdateOrgTemplateVersion = jest.fn();
const mockListOrgTemplates = jest.fn();
const mockToCreateResponse = jest.fn();
const mockToSummary = jest.fn();

jest.mock('@api-hub/template-core', () => {
  const actual = jest.requireActual<typeof import('@api-hub/template-core')>('@api-hub/template-core');
  return {
    ...actual,
    OrgTemplateService: jest.fn().mockImplementation(() => ({
      cloneTemplateVersion: mockCloneTemplateVersion,
      getOrgTemplateVersions: mockGetOrgTemplateVersions,
      updateOrgTemplateVersion: mockUpdateOrgTemplateVersion,
      listOrgTemplates: mockListOrgTemplates,
      toCreateResponse: mockToCreateResponse,
      toSummary: mockToSummary,
    })),
  };
});

function baseReq(overrides: Partial<LambdaRequest & Record<string, unknown>> = {}): LambdaRequest {
  return {
    event: { headers: { Authorization: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }) } },
    params: {},
    body: {},
    context: {
      correlationId: 'c1',
      awsRequestId: 'a1',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      authHeader: bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'user-1' }),
    },
    ...overrides,
  } as LambdaRequest;
}

describe('OrgTemplateHttpController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handleCloneToOrg returns create response', async () => {
    const record = minimalMasterTemplateRecord();
    mockCloneTemplateVersion.mockResolvedValue(record);
    mockToCreateResponse.mockReturnValue({
      templateId: 'CP-ORG-001',
      templateVersionId: 'CP-ORG-001-V01',
      version: 1,
      status: 'DRAFT',
    });

    const c = new OrgTemplateHttpController();
    const out = await c.handleCloneToOrg(
      baseReq({
        validatedCloneOrgTemplate: {
          organizationId: 'org-1',
          templateId: 'CP-HTN-001',
          versionId: 'V01',
          body: { newTemplateName: 'Org Copy' },
          actorUserId: 'user-1',
        },
      } as unknown as LambdaRequest),
    );

    expect(out.templateId).toBe('CP-ORG-001');
    expect(mockCloneTemplateVersion).toHaveBeenCalled();
  });

  it('handleListOrg returns items from service', async () => {
    mockListOrgTemplates.mockResolvedValue({ items: [{ templateId: 'CP-ORG-001' }] });

    const c = new OrgTemplateHttpController();
    const out = await c.handleListOrg(
      baseReq({
        validatedListOrg: {
          organizationId: 'org-1',
          query: { status: 'DRAFT' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.items).toHaveLength(1);
  });

  it('handleUpdateOrgVersion returns summary', async () => {
    const record = minimalMasterTemplateRecord();
    mockUpdateOrgTemplateVersion.mockResolvedValue(record);
    mockToSummary.mockReturnValue({ templateId: 'CP-ORG-001', version: 2, status: 'DRAFT' });

    const c = new OrgTemplateHttpController();
    const out = await c.handleUpdateOrgVersion(
      baseReq({
        validatedUpdateOrgVersion: {
          organizationId: 'org-1',
          templateId: 'CP-ORG-001',
          versionId: 'V01',
          body: { meta: { templateName: 'Updated' } },
          actorUserId: 'user-1',
        },
      } as unknown as LambdaRequest),
    );

    expect(out.version).toBe(2);
  });
});
