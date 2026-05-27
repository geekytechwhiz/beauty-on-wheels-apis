import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { TemplateKeyBuilder, type TemplateDdbRecord } from '@api-hub/template-core';

export function bearerToken(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `Bearer header.${encoded}.signature`;
}

export function testLambdaContext(): Context {
  return {
    awsRequestId: 'test-aws-request-id',
    getRemainingTimeInMillis: () => 30000,
  } as unknown as Context;
}

export function minimalMasterTemplateRecord(
  overrides: Partial<TemplateDdbRecord> = {},
): TemplateDdbRecord {
  return {
    pk: TemplateKeyBuilder.toMasterPk('CP-HTN-001'),
    sk: 'VERSION#001',
    entityType: 'MASTER_TEMPLATE',
    gsi5pk: 'SCOPE#MASTER#STATUS#DRAFT',
    gsi5sk: 'TS#2024-01-01T00:00:00Z#CP-HTN-001',
    gsi4pk: 'CODE#CP_HTN_STANDARD',
    gsi4sk: 'VER#001#CP-HTN-001',
    meta: {
      templateId: 'CP-HTN-001',
      templateVersionId: 'CP-HTN-001-V01',
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Management Plan',
      templateType: 'CARE_PLAN',
      category: 'CHRONIC_DISEASE',
      condition: 'HYPERTENSION',
      countries: ['IN'],
      version: 1,
      status: 'DRAFT',
      isActive: true,
      publishedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      lastModifiedAt: '2024-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

export function minimalCreateMasterBody() {
  return {
    templateCode: 'CP_HTN_STANDARD',
    templateName: 'Hypertension Management Plan',
    templateType: 'CARE_PLAN',
    status: 'DRAFT',
    category: ['CHRONIC_DISEASE'],
    conditions: ['HYPERTENSION'],
    countries: ['IN'],
    languages: ['en'],
    specialty: ['CARDIOLOGY'],
    version: 1,
  };
}

export function basePostEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/dev/templates/master',
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'user-1',
      }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(minimalCreateMasterBody()),
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

export function baseGetMasterListEvent(
  overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/templates/master',
    pathParameters: null,
    queryStringParameters: { status: 'DRAFT' },
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'user-1',
      }),
    },
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

export function authHeaders(orgId = 'ROOT', userId = 'user-1') {
  return {
    Authorization: bearerToken({
      'custom:organizationID': orgId,
      'custom:userID': userId,
    }),
  };
}

export function publishedMasterTemplateRecord(
  overrides: Partial<TemplateDdbRecord> = {},
): TemplateDdbRecord {
  return minimalMasterTemplateRecord({
    gsi2pk: 'TYPE#CARE_PLAN#SCOPE#MASTER',
    gsi2sk: 'PUB#2024-04-01T00:00:00Z#CP-HTN-001#CP-HTN-001-V01',
    meta: {
      templateId: 'CP-HTN-001',
      templateVersionId: 'CP-HTN-001-V01',
      templateCode: 'CP_HTN_STANDARD',
      templateName: 'Hypertension Management Plan',
      templateType: 'CARE_PLAN',
      condition: 'HYPERTENSION',
      countries: ['IN'],
      version: 1,
      status: 'PUBLISHED',
      isActive: true,
      publishedAt: '2024-04-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      lastModifiedAt: '2024-04-01T00:00:00Z',
    },
    carePlanAttributes: {
      duration: { durationType: 'MONTHS_6' },
    },
    ...overrides,
  });
}

/** Shared Jest mock factory for `@api-hub/middleware` withApiHandler (used in handler specs). */
export function createWithApiHandlerMock() {
  const { ApiResponse } = jest.requireActual<typeof import('@api-hub/utils')>('@api-hub/utils');

  function tryParseJson(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    if (body.trim() === '') return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return Symbol.for('invalid-json');
    }
  }

  return {
    withApiHandler:
      (
        options: {
          bodySchema?: { parse: (b: unknown) => unknown };
          validator?: (req: unknown) => Promise<void>;
        },
        handler: (req: unknown) => Promise<unknown>,
      ) =>
      async (event: import('aws-lambda').APIGatewayProxyEvent) => {
        const parsedBody = tryParseJson(event?.body);
        if (parsedBody === Symbol.for('invalid-json')) {
          return ApiResponse.unprocessableEntity(
            { title: 'INVALID_JSON', description: 'Invalid JSON body', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code: 'INVALID_JSON' },
          );
        }

        const authHeader = event?.headers?.Authorization ?? event?.headers?.authorization;
        const req = {
          event,
          params: { ...(event?.pathParameters ?? {}), ...(event?.queryStringParameters ?? {}) },
          body: parsedBody,
          pathParameters: event?.pathParameters ?? undefined,
          context: {
            correlationId: 'test-correlation-id',
            awsRequestId: 'test-aws-request-id',
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            authHeader,
          },
        };

        try {
          if (options?.bodySchema) {
            req.body = options.bodySchema.parse(req.body);
          }
          if (options?.validator) {
            await options.validator(req);
          }
          const out = await handler(req);
          return ApiResponse.ok(
            out,
            { title: 'SUCCESS', description: 'Request processed successfully', severity: 'SUCCESS' },
            { correlationId: 'test-correlation-id' },
          );
        } catch (e: unknown) {
          const err = e as { name?: string; statusCode?: number; code?: string; message?: string };
          if (err?.name === 'ZodError') {
            return ApiResponse.unprocessableEntity(
              { title: 'VALIDATION_ERROR', description: 'Validation failed', severity: 'ERROR' },
              { correlationId: 'test-correlation-id' },
              { code: 'VALIDATION_ERROR' },
            );
          }
          return ApiResponse.error(
            err?.statusCode ?? 500,
            { title: err?.code ?? 'INTERNAL_ERROR', description: err?.message ?? 'Error', severity: 'ERROR' },
            { correlationId: 'test-correlation-id' },
            { code: err?.code ?? 'INTERNAL_ERROR' },
          );
        }
      },
  };
}

export function setupHandlerTestEnv(): { restore: () => void } {
  process.env.ERROR_MESSAGES_CDN_URL =
    process.env.ERROR_MESSAGES_CDN_URL ?? 'https://d2p9v61861q1ox.cloudfront.net';
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
  process.env.TEMPLATE_TABLE = process.env.TEMPLATE_TABLE ?? 'template-service-dev';
  process.env.TEMPLATE_EVENT_BUS_NAME =
    process.env.TEMPLATE_EVENT_BUS_NAME ?? 'template-service-bus-dev';

  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  return {
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}
