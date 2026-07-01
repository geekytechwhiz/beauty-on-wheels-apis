import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

import { testLambdaContext } from '../../__tests__/handler-test-utils';
import { main } from './health';

describe('health HTTP handler', () => {
  const originalRegion = process.env.AWS_REGION;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env.AWS_REGION = originalRegion;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns healthy status payload', async () => {
    const event = {
      headers: { 'x-correlation-id': 'health-corr-1' },
    } as unknown as APIGatewayProxyEvent;

    const res = await main(event, testLambdaContext());
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.data).toMatchObject({
      status: 'healthy',
      service: 'task-service',
      region: 'us-east-1',
      stage: 'test',
    });
    expect(body.data.timestamp).toEqual(expect.any(String));
  });

  it('works without Lambda context', async () => {
    const event = { headers: {} } as unknown as APIGatewayProxyEvent;
    const res = await main(event, undefined as unknown as Context);
    expect(res.statusCode).toBe(200);
  });
});
