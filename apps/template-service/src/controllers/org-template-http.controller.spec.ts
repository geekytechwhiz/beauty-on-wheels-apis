import type { LambdaRequest } from '@api-hub/utils';

import { bearerToken, minimalMasterTemplateRecord } from '../__tests__/handler-test-utils';
import { OrgTemplateHttpController } from './org-template-http.controller';

const mockCloneTemplateVersion = jest.fn();
const mockGetOrgTemplateVersions = jest.fn();
const mockUpdateOrgTemplateVersion = jest.fn();
const mockListOrgEnabled = jest.fn();
const mockGetOrgVersionStatus = jest.fn();
const mockSetOrgTemplateEnablement = jest.fn();
const mockToDeriveEnableResponse = jest.fn();
const mockToSummary = jest.fn();

jest.mock('@api-hub/template-core', () => {
  const actual = jest.requireActual<typeof import('@api-hub/template-core')>('@api-hub/template-core');
  return {
    ...actual,
    OrgTemplateService: jest.fn().mockImplementation(() => ({
      cloneTemplateVersion: mockCloneTemplateVersion,
      getOrgTemplateVersions: mockGetOrgTemplateVersions,
      updateOrgTemplateVersion: mockUpdateOrgTemplateVersion,
      listOrgEnabled: mockListOrgEnabled,
      getOrgVersionStatus: mockGetOrgVersionStatus,
      setOrgTemplateEnablement: mockSetOrgTemplateEnablement,
      toDeriveEnableResponse: mockToDeriveEnableResponse,
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

  it('handleCloneToOrg returns derive enable response', async () => {
    const record = minimalMasterTemplateRecord();
    mockCloneTemplateVersion.mockResolvedValue({
      record,
      masterVersion: record,
      enablement: { meta: { enablementId: 'ENB-ORG1-ABC' } },
      templateEnabled: true,
    });
    mockToDeriveEnableResponse.mockReturnValue({
      masterTemplate: { templateId: 'CP-HTN-001', status: 'PUBLISHED' },
      orgTemplate: { templateId: 'CP-ORG-001', status: 'DRAFT' },
      templateEnabled: true,
      enablementId: 'ENB-ORG1-ABC',
    });

    const c = new OrgTemplateHttpController();
    const out = await c.handleCloneToOrg(
      baseReq({
        validatedCloneOrgTemplate: {
          organizationId: 'org-1',
          templateId: 'CP-HTN-001',
          versionId: 'V01',
          body: { templateId: 'CP-HTN-001' },
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.orgTemplate.templateId).toBe('CP-ORG-001');
    expect(out.templateEnabled).toBe(true);
    expect(mockCloneTemplateVersion).toHaveBeenCalled();
  });

  it('handleListOrg returns items from service', async () => {
    mockListOrgEnabled.mockResolvedValue({
      mode: 'single',
      organizationMeta: { id: 'org-1', name: 'org-1', description: null },
      items: [
        {
          masterTemplate: { templateId: 'CP-HTN-001', templateVersionId: 'CP-HTN-001-V01', status: 'PUBLISHED', isActive: true },
          orgTemplate: { templateId: 'CP-ORG-001', templateVersionId: 'CP-ORG-001-V01', status: 'DRAFT' },
          enablementId: 'ENB-1',
          enabledAt: '2026-01-01T00:00:00.000Z',
          templateEnabled: true,
          upgrade: false,
        },
      ],
      counts: { total: 1 },
      pagination: { limit: 20, count: 1, total: 1, hasMore: false },
      filterOptions: {
        conditionCode: [],
        categoryCode: [],
        templateType: [],
        templateName: [],
        country: ['US', 'UK', 'Australia'],
      },
    });

    const c = new OrgTemplateHttpController();
    const out = await c.handleListOrg(
      baseReq({
        validatedListOrg: {
          organizationId: 'org-1',
          listAllOrganizations: false,
          query: { status: 'DRAFT' },
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.items).toHaveLength(1);
  });

  it('handleSetOrgTemplateEnable disables subscription', async () => {
    mockSetOrgTemplateEnablement.mockResolvedValue({
      templateId: 'CP-HTN-MASTER',
      orgTemplateId: 'CP-HTN-MASTER-ORG-ORG1',
      enablementId: 'ENB-1',
      templateEnabled: false,
      disabledAt: '2026-06-04T00:00:00.000Z',
    });

    const c = new OrgTemplateHttpController();
    const out = await c.handleSetOrgTemplateEnable(
      baseReq({
        validatedSetOrgTemplateEnable: {
          organizationId: 'org-1',
          masterTemplateId: 'CP-HTN-MASTER',
          body: { templateId: 'CP-HTN-MASTER', organizationId: 'org-1', templateEnabled: false },
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.templateEnabled).toBe(false);
    expect(mockSetOrgTemplateEnablement).toHaveBeenCalled();
  });

  it('handleGetOrgVersionStatus returns version row', async () => {
    mockGetOrgVersionStatus.mockResolvedValue({
      templateId: 'CP-HTN-MASTER',
      templateName: 'HTN Care Plan — Standard',
      currentOrgVersion: 1,
      upgradeAvailable: true,
      upgradeStatus: 'AVAILABLE',
      localChangesPresent: false,
      localChangesLabel: 'None',
    });

    const c = new OrgTemplateHttpController();
    const out = await c.handleGetOrgVersionStatus(
      baseReq({
        validatedGetOrgVersionStatus: {
          organizationId: 'org-1',
          masterTemplateId: 'CP-HTN-MASTER',
          query: { templateId: 'CP-HTN-MASTER' },
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.upgradeAvailable).toBe(true);
    expect(out.localChangesLabel).toBe('None');
    expect(mockGetOrgVersionStatus).toHaveBeenCalledWith({
      organizationId: 'org-1',
      masterTemplateId: 'CP-HTN-MASTER',
      organizationName: undefined,
      organizationDescription: undefined,
    });
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
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.version).toBe(2);
  });
});
