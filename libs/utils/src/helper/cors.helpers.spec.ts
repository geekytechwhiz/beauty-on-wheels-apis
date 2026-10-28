import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ApiResponse } from './http-response.helpers';
import { handleError } from '../middleware/error.middleware';
import {
  buildCorsHeaders,
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  configuredAllowedOrigins,
  corsPreflightResponse,
  DEFAULT_CORS_ALLOWED_ORIGINS_VALUE,
  isHttpApiV2Event,
  isHttpPreflight,
  resolveCorsOrigin,
  runWithCorsContext,
} from './cors.helpers';

const EXPO_ORIGIN = 'http://localhost:8081';

function restEvent(origin?: string) {
  return {
    httpMethod: 'POST',
    headers: origin ? { Origin: origin } : {},
  };
}

describe('cors helpers', () => {
  const originalCors = process.env.CORS_ALLOWED_ORIGINS;
  const originalAllowed = process.env.ALLOWED_ORIGIN;

  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGIN;
  });

  afterAll(() => {
    if (originalCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCors;
    if (originalAllowed === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = originalAllowed;
  });

  it('allows the Expo Web origin and the headers browsers send', () => {
    expect(configuredAllowedOrigins()).toEqual(
      DEFAULT_CORS_ALLOWED_ORIGINS_VALUE.split(','),
    );
    const headers = buildCorsHeaders(restEvent(EXPO_ORIGIN));
    expect(headers['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
    for (const name of ['Authorization', 'Content-Type', 'Idempotency-Key']) {
      expect(headers['Access-Control-Allow-Headers']).toContain(name);
    }
    for (const method of ['OPTIONS', 'POST', 'PATCH', 'DELETE']) {
      expect(headers['Access-Control-Allow-Methods']).toContain(method);
    }
    expect(Object.keys(headers).filter((key) => key === 'Access-Control-Allow-Origin')).toHaveLength(1);
  });

  it('omits CORS headers for an origin that is not configured', () => {
    expect(buildCorsHeaders(restEvent('https://evil.example'))).toEqual({});
    expect(resolveCorsOrigin('https://evil.example', configuredAllowedOrigins())).toBeNull();
  });

  it('reflects any origin without a wildcard when the allowlist is *', () => {
    process.env.CORS_ALLOWED_ORIGINS = '*';
    const headers = buildCorsHeaders(restEvent(EXPO_ORIGIN));
    expect(headers['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('does not add CORS headers on HTTP API v2 responses', () => {
    const event = {
      version: '2.0',
      headers: { origin: EXPO_ORIGIN },
      requestContext: { http: { method: 'POST' } },
    };
    expect(isHttpApiV2Event(event)).toBe(true);
    expect(buildCorsHeaders(event)).toEqual({});
    expect(corsPreflightResponse({ ...event, requestContext: { http: { method: 'OPTIONS' } } }).headers[
      'Access-Control-Allow-Origin'
    ]).toBe(EXPO_ORIGIN);
  });

  it('treats API Gateway OPTIONS as a preflight and ignores async events', () => {
    expect(isHttpPreflight({ httpMethod: 'OPTIONS', headers: {} })).toBe(true);
    expect(isHttpPreflight({ httpMethod: 'POST' })).toBe(false);
    expect(isHttpPreflight({ Records: [] })).toBe(false);
  });

  it('puts the same allowlist in the shared Serverless fragments', () => {
    const root = join(__dirname, '../../../..');
    const origins = readFileSync(
      join(root, 'infra/serverless/config/cors-allowed-origins.yml'),
      'utf8',
    );
    const rest = readFileSync(
      join(root, 'infra/serverless/config/rest-api-cors.yml'),
      'utf8',
    );
    const httpApi = readFileSync(
      join(root, 'infra/serverless/config/http-api-cors.yml'),
      'utf8',
    );
    const gateway = readFileSync(
      join(root, 'infra/serverless/config/rest-gateway-cors-responses.yml'),
      'utf8',
    );
    expect(origins).toContain(DEFAULT_CORS_ALLOWED_ORIGINS_VALUE);
    expect(rest).toContain('allowCredentials: true');
    expect(httpApi).toContain('allowCredentials: true');
    for (const header of CORS_ALLOW_HEADERS) {
      expect(rest).toContain(`- ${header}`);
      expect(httpApi).toContain(`- ${header}`);
      expect(gateway).toContain(header);
    }
    for (const method of CORS_ALLOW_METHODS) {
      expect(rest).toContain(`- ${method}`);
      expect(gateway).toContain(method);
    }
    expect(gateway).not.toContain("Access-Control-Allow-Origin: \"'*'\"");
  });

  it('wires every HTTP service to the shared CORS config', () => {
    const root = join(__dirname, '../../../..');
    const services = [
      'availability-service',
      'booking-service',
      'email-service',
      'identity-v1-service',
      'service-catalog-service',
      'user-service',
      'vehicle-service',
      'vendor-service',
      'whatsapp-channel-service',
    ];
    for (const service of services) {
      const serverless = readFileSync(join(root, 'apps', service, 'serverless.yml'), 'utf8');
      expect(serverless).toContain('cors: ${self:custom.httpCors}');
      expect(serverless).toContain('httpCors: ${file(../../infra/serverless/config/rest-api-cors.yml)}');
      expect(serverless).toContain('CORS_ALLOWED_ORIGINS: ${self:custom.corsAllowedOrigins}');
      expect(serverless).toContain('rest-gateway-cors-responses.yml');
      expect(serverless).not.toContain('cors: true');
      expect(serverless).not.toContain("Access-Control-Allow-Origin: \"'*'\"");
    }
  });
});

describe('response CORS', () => {
  const originalCors = process.env.CORS_ALLOWED_ORIGINS;

  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterAll(() => {
    if (originalCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCors;
  });

  it('adds Expo CORS headers to success and error responses', async () => {
    const event = restEvent(EXPO_ORIGIN);
    const success = runWithCorsContext(event, () =>
      ApiResponse.ok({ id: 'veh-1' }, 'Created', { correlationId: 'corr-1' }),
    );
    expect(success.headers?.['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(success.headers?.['Access-Control-Allow-Credentials']).toBe('true');

    const failure = await handleError(new Error('nope'), {
      correlationId: 'corr-1',
      event,
      skipLog: true,
    });
    expect(failure.statusCode).toBe(500);
    expect(failure.headers?.['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(failure.headers?.['Access-Control-Allow-Headers']).toContain('Idempotency-Key');
  });
});
