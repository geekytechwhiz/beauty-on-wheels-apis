import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { main } from './health';

describe('health handler', () => {
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

  it('returns 200 and success payload for GET /health', async () => {
    // Arrange
    const event = {
      httpMethod: 'GET',
      path: '/health',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    } as unknown as APIGatewayProxyEvent;

    const context = {
      awsRequestId: 'test-aws-request-id',
      getRemainingTimeInMillis: () => 30000,
    } as unknown as Context;

    // Act
    const result = await main(event, context);

    // Assert
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as {
      success: boolean;
      data: { status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ status: 'ok' });
  });
});
