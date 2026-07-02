import type { LambdaRequest } from '@api-hub/utils';

import { bearerToken } from '../__tests__/handler-test-utils';
import {
  collectTemplateQueryParams,
  resolveListTemplateLevel,
  resolveTemplateLevelFromQuery,
} from './template-level.util';

function listReq(
  query: Record<string, string>,
  overrides: Partial<LambdaRequest> = {},
): LambdaRequest {
  return {
    event: {
      headers: { Authorization: bearerToken({ 'custom:organizationID': 'ROOT' }) },
      queryStringParameters: query,
    },
    params: { ...query },
    body: {},
    context: {
      correlationId: 'c1',
      awsRequestId: 'a1',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      authHeader: bearerToken({ 'custom:organizationID': 'ROOT' }),
    },
    ...overrides,
  } as LambdaRequest;
}

describe('template-level.util', () => {
  it('collectTemplateQueryParams canonicalizes lowercase keys from serverless-offline', () => {
    expect(
      collectTemplateQueryParams([
        { templatelevel: 'ORG_CARE_PLAN', organizationid: 'org-1' },
      ]),
    ).toEqual({
      templateLevel: 'ORG_CARE_PLAN',
      organizationId: 'org-1',
    });
  });

  it('resolveTemplateLevelFromQuery returns ORG_CARE_PLAN when templateLevel is set with organizationId', () => {
    const level = resolveTemplateLevelFromQuery(
      listReq({
        templateLevel: 'ORG_CARE_PLAN',
        organizationId: 'mqf0agcd0aa65849',
        country: 'all',
      }),
    );
    expect(level).toBe('ORG_CARE_PLAN');
  });

  it('resolveTemplateLevelFromQuery does not default to ORG when lowercase templatelevel is set', () => {
    const level = resolveTemplateLevelFromQuery(
      listReq({
        templatelevel: 'ORG_CARE_PLAN',
        organizationid: 'mqf0agcd0aa65849',
      }),
    );
    expect(level).toBe('ORG_CARE_PLAN');
  });

  it('resolveTemplateLevelFromQuery defaults to ORG when only organizationId is present', () => {
    const level = resolveTemplateLevelFromQuery(
      listReq({ organizationId: 'mqf0agcd0aa65849' }),
    );
    expect(level).toBe('ORG');
  });

  it('resolveTemplateLevelFromQuery defaults to MASTER without org context', () => {
    const level = resolveTemplateLevelFromQuery({
      event: { headers: {} },
      params: {},
      body: {},
      context: { correlationId: 'c1', awsRequestId: 'a1', logger: {} },
    } as LambdaRequest);
    expect(level).toBe('MASTER');
  });

  it('resolveListTemplateLevel prefers validated query level', () => {
    const level = resolveListTemplateLevel(
      listReq({ organizationId: 'org-1' }),
      'ORG_CARE_PLAN',
    );
    expect(level).toBe('ORG_CARE_PLAN');
  });
});
