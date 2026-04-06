import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { main } from './createTemplate';

// eslint-disable-next-line no-var
var mockCreateExecute: jest.Mock;

jest.mock('../runtime', () => {
  mockCreateExecute = jest.fn();
  return {
    getTemplateRuntime: jest.fn(() => ({
      createTemplateUseCase: { execute: mockCreateExecute },
    })),
  };
});


describe('createTemplate handler', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeAll(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    mockCreateExecute.mockReset();
  });

  const context = {
    awsRequestId: 'test-aws-request-id',
    getRemainingTimeInMillis: () => 30000,
  } as unknown as Context;

  function postEvent(body: unknown): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: '/dev/templates',
      pathParameters: null,
      queryStringParameters: null,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } as unknown as APIGatewayProxyEvent;
  }

  it('returns 201 when validation passes and use case succeeds', async () => {
    // Arrange
    const created = { templateId: 'new-1', version: '1.0.0' };
    mockCreateExecute.mockResolvedValue(created);
    const event = postEvent({
      templateId: 'new-1',
      config: {},
    });

    // Act
    const result = await main(event, context);

    // Assert
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean; data: typeof created };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(created);
    expect(mockCreateExecute).toHaveBeenCalledTimes(1);
    const arg = mockCreateExecute.mock.calls[0][0] as { body: { templateId: string } };
    expect(arg.body.templateId).toBe('new-1');
  });

  it('returns 400 when body fails schema validation (missing templateId)', async () => {
    // Arrange
    const event = postEvent({ config: {} });

    // Act
    const result = await main(event, context);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(mockCreateExecute).not.toHaveBeenCalled();
    const body = JSON.parse(result.body ?? '{}') as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('returns 400 when body is not valid JSON', async () => {
    // Arrange
    const event = {
      httpMethod: 'POST',
      path: '/dev/templates',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    } as unknown as APIGatewayProxyEvent;

    // Act
    const result = await main(event, context);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(mockCreateExecute).not.toHaveBeenCalled();
  });

  it('maps use case errors to HTTP error responses', async () => {
    // Arrange
    mockCreateExecute.mockRejectedValue(new Error('ConditionalCheckFailed'));
    const event = postEvent({
      templateId: 'dup-1',
      config: {},
    });

    // Act
    const result = await main(event, context);

    // Assert
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
    const body = JSON.parse(result.body ?? '{}') as { success: boolean };
    expect(body.success).toBe(false);
  });
});
