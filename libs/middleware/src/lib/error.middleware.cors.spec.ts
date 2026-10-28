import { BaseError } from '@api-hub/utils';

import { httpApiErrorMiddleware } from './error.middleware';

const EXPO_ORIGIN = 'http://localhost:8081';

describe('httpApiErrorMiddleware CORS', () => {
  const originalCors = process.env.CORS_ALLOWED_ORIGINS;

  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterAll(() => {
    if (originalCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCors;
  });

  it('answers OPTIONS preflight without calling the handler', async () => {
    const next = jest.fn();
    const middleware = httpApiErrorMiddleware();
    const response = await middleware({
      event: {
        httpMethod: 'OPTIONS',
        headers: {
          Origin: EXPO_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
        },
      },
      context: {},
      next,
    });

    expect(next).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': EXPO_ORIGIN,
        'Access-Control-Allow-Credentials': 'true',
      },
    });
    const headers = (response as { headers: Record<string, string> }).headers;
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(headers['Access-Control-Allow-Headers']).toContain('Idempotency-Key');
  });

  it('keeps CORS headers on pipeline errors', async () => {
    const middleware = httpApiErrorMiddleware();
    const response = await middleware({
      event: {
        httpMethod: 'POST',
        headers: { Origin: EXPO_ORIGIN },
      },
      context: {},
      next: async () => {
        throw new BaseError('User is not authenticated', 401, 'UNAUTHORIZED');
      },
    });

    expect(response).toMatchObject({
      statusCode: 401,
      headers: {
        'Access-Control-Allow-Origin': EXPO_ORIGIN,
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  });
});
