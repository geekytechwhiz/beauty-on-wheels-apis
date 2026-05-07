import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

/** `var` + assignment inside factory avoids Jest hoist / TDZ issues with `const` + mock factories. */
// eslint-disable-next-line no-var
var mockGetTemplateExecute: jest.Mock;

jest.mock('../runtime', () => {
  mockGetTemplateExecute = jest.fn();
  return {
    getTemplateRuntime: jest.fn(() => ({
      getTemplateUseCase: { execute: mockGetTemplateExecute },
    })),
  };
});

import { main } from './getTemplate';

describe('getTemplate handler', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  function bearerToken(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `Bearer header.${encoded}.signature`;
  }

  beforeAll(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    mockGetTemplateExecute.mockReset();
  });

  function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      httpMethod: 'GET',
      path: '/dev/templates/tpl-1',
      pathParameters: { id: 'tpl-1' },
      queryStringParameters: null,
      headers: {
        Authorization: bearerToken({ organizationId: 'org-1', sub: 'user-1' }),
      },
      body: null,
      ...overrides,
    } as unknown as APIGatewayProxyEvent;
  }

  const context = {
    awsRequestId: 'test-aws-request-id',
    getRemainingTimeInMillis: () => 30000,
  } as unknown as Context;

  it('returns 200 and passes validated input to the use case (success)', async () => {
    // Arrange
    const payload = { templateId: 'tpl-1', name: 'Example' };
    mockGetTemplateExecute.mockResolvedValue(payload);

    // Act
    const result = await main(baseEvent(), context);

    // Assert
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean; data: typeof payload };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(payload);
    expect(mockGetTemplateExecute).toHaveBeenCalledTimes(1);
    const arg = mockGetTemplateExecute.mock.calls[0][0] as {
      templateId: string;
      view: string;
    };
    expect(arg.templateId).toBe('tpl-1');
    expect(arg.view).toBe('published');
  });

  it('returns 404 when the use case resolves with no template', async () => {
    // Arrange
    mockGetTemplateExecute.mockResolvedValue(null);

    // Act
    const result = await main(baseEvent(), context);

    // Assert
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean; error: unknown };
    expect(body.success).toBe(false);
  });

  it('returns 400 when template id is missing (validation)', async () => {
    // Arrange
    // No `id` in pathParameters → validation fails before the use case runs
    const event = baseEvent({
      pathParameters: {},
    });

    // Act
    const result = await main(event, context);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(mockGetTemplateExecute).not.toHaveBeenCalled();
  });

  it('uses view=raw when query string requests raw', async () => {
    // Arrange
    mockGetTemplateExecute.mockResolvedValue({ templateId: 'tpl-1' });
    const event = baseEvent({
      queryStringParameters: { view: 'raw' },
    });

    // Act
    await main(event, context);

    // Assert
    const arg = mockGetTemplateExecute.mock.calls[0][0] as { view: string };
    expect(arg.view).toBe('raw');
  });

  it('propagates use case failures as error responses', async () => {
    // Arrange
    mockGetTemplateExecute.mockRejectedValue(new Error('DynamoDB timeout'));

    // Act
    const result = await main(baseEvent(), context);

    // Assert
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean };
    expect(body.success).toBe(false);
  });
});
