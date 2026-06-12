import type { LambdaRequest } from '@api-hub/utils';

import {
  bearerToken,
  minimalCreateMasterBody,
  minimalMasterTemplateRecord,
} from '../__tests__/handler-test-utils';
import { TemplateHttpController } from './template-http.controller';

const mockCreateMasterTemplate = jest.fn();
const mockListMasterTemplates = jest.fn();
const mockToCreateResponse = jest.fn();
const mockSaveMasterTemplate = jest.fn();
const mockToSummary = jest.fn();

jest.mock('@api-hub/template-core', () => {
  const actual = jest.requireActual<typeof import('@api-hub/template-core')>('@api-hub/template-core');
  return {
    ...actual,
    TemplateService: jest.fn().mockImplementation(() => ({
      createMasterTemplate: mockCreateMasterTemplate,
      listMasterTemplates: mockListMasterTemplates,
      toCreateResponse: mockToCreateResponse,
      saveMasterTemplate: mockSaveMasterTemplate,
      toSummary: mockToSummary,
    })),
  };
});

function baseReq(overrides: Partial<LambdaRequest & Record<string, unknown>> = {}): LambdaRequest {
  return {
    event: {
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'org-1',
          'custom:userID': 'user-1',
        }),
      },
    },
    params: {},
    body: {},
    context: {
      correlationId: 'c1',
      awsRequestId: 'a1',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      authHeader: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'user-1',
      }),
    },
    ...overrides,
  } as LambdaRequest;
}

describe('TemplateHttpController', () => {
  beforeEach(() => {
    mockCreateMasterTemplate.mockReset();
    mockListMasterTemplates.mockReset();
    mockToCreateResponse.mockReset();
    mockSaveMasterTemplate.mockReset();
    mockToSummary.mockReset();
  });

  it('handleCreateMaster throws 500 when validation missing', async () => {
    const c = new TemplateHttpController();
    await expect(c.handleCreateMaster(baseReq())).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('handleCreateMaster returns summary on success', async () => {
    const record = minimalMasterTemplateRecord();
    mockCreateMasterTemplate.mockResolvedValue({ record });
    mockToCreateResponse.mockReturnValue({
      templateId: record.meta.templateId,
      templateVersionId: record.meta.templateVersionId,
      version: 1,
      status: 'DRAFT',
    });

    const c = new TemplateHttpController();
    const out = await c.handleCreateMaster(
      baseReq({
        validatedCreateMaster: {
          actorUser: { userId: 'user-1' },
          body: minimalCreateMasterBody(),
        },
      } as unknown as LambdaRequest),
    );

    expect(out.templateId).toBe('CP-HTN-001');
    expect(mockCreateMasterTemplate).toHaveBeenCalledWith(
      minimalCreateMasterBody(),
      { userId: 'user-1' },
    );
  });

  it('handleListMaster returns items', async () => {
    mockListMasterTemplates.mockResolvedValue({
      items: [
        {
          templateId: 'CP-HTN-001',
          templateVersionId: 'CP-HTN-001-V01',
          version: 1,
          status: 'DRAFT',
          isActive: true,
        },
      ],
    });

    const c = new TemplateHttpController();
    const out = await c.handleListMaster(
      baseReq({
        validatedListMaster: {
          query: { status: 'DRAFT' },
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.items).toHaveLength(1);
    expect(mockListMasterTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DRAFT' }),
    );
  });

  it('handleSaveMaster returns summary', async () => {
    const record = minimalMasterTemplateRecord();
    mockSaveMasterTemplate.mockResolvedValue(record);
    mockToSummary.mockReturnValue({
      templateId: record.meta.templateId,
      templateVersionId: record.meta.templateVersionId,
      version: 2,
      status: 'DRAFT',
    });

    const c = new TemplateHttpController();
    const out = await c.handleSaveMaster(
      baseReq({
        validatedSaveMaster: {
          templateId: 'CP-HTN-001',
          templateVersionId: 'V01',
          body: { meta: { templateName: 'Updated' } },
          actorUser: { userId: 'user-1' },
        },
      } as unknown as LambdaRequest),
    );

    expect(out.version).toBe(2);
    expect(mockSaveMasterTemplate).toHaveBeenCalled();
  });
});
