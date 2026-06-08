jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    createChild: jest.fn().mockReturnThis(),
    appendKeys: jest.fn().mockReturnThis(),
  })),
}));

import {
  configureObservability,
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  extractCorrelationId,
  getLoggerContext,
  getPowertoolsLogger,
  logHttpRequest,
  serializeError,
  withLambdaObservability,
  withLoggerContext,
} from '../src/index';

const getPowertoolsMock = (): {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} => {
  return getPowertoolsLogger() as unknown as {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
};

describe('@api-hub/observability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureObservability({
      serviceName: 'jest-observability',
      logLevel: 'DEBUG',
      sampling: { info: 1, debug: 1 },
      redactPII: false,
      enforceLogPolicy: false,
    });
    getPowertoolsLogger();
  });

  it('propagates logger context across async boundaries', async () => {
    await withLoggerContext(
      { correlationId: 'corr-1', tenantId: 'tenant-1' },
      async () => {
        await Promise.resolve();
        expect(getLoggerContext()).toMatchObject({
          correlationId: 'corr-1',
          tenantId: 'tenant-1',
        });
      },
    );
  });

  it('serializes errors with stack information', () => {
    const err = new Error('boom');
    const serialized = serializeError(err);
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('boom');
    expect(String(serialized.stack)).toContain('boom');
  });

  it('serializes error-like plain objects without SerializedUnknownRejection wrapper', () => {
    const broken = Object.assign(Object.create(null), {
      name: 'Error',
      message: 'Invalid input: expected object, received undefined',
      stack: 'Error: Invalid input\n    at validate',
      code: 'VALIDATION_ERROR',
      statusCode: 422,
    });

    const serialized = serializeError(broken);

    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe(
      'Invalid input: expected object, received undefined',
    );
    expect(serialized.code).toBe('VALIDATION_ERROR');
    expect(serialized.statusCode).toBe(422);
    expect(serialized).not.toHaveProperty('value');
  });

  it('wraps truly unknown objects as SerializedUnknownRejection', () => {
    const serialized = serializeError({ foo: 'bar' });

    expect(serialized.name).toBe('SerializedUnknownRejection');
    expect(serialized.message).toBe('Non-Error value logged');
    expect(serialized.value).toEqual({ foo: 'bar' });
  });

  it('creates structured child logger with merged keys', () => {
    const parent = createLogger();
    const child = createChildLogger(parent, { organizationId: 'org-1' });
    expect(child.getPersistentKeys()).toMatchObject({
      organizationId: 'org-1',
    });
  });

  it('logs http request via getLogger path', () => {
    logHttpRequest('GET', '/health', 200, 12, 'corr-2');
    expect(getPowertoolsMock().info).toHaveBeenCalled();
  });

  it('legacy logHttpRequest ignores first logger argument', () => {
    logHttpRequest({}, 'GET', '/health', 200, 12, 'corr-2');
    expect(getPowertoolsMock().info).toHaveBeenCalled();
  });

  it('withLambdaObservability sets ALS context', async () => {
    const handler = withLambdaObservability(async () => {
      const ctx = getLoggerContext();
      expect(ctx.awsRequestId).toBe('aws-1');
      expect(typeof ctx.correlationId).toBe('string');
      expect(ctx.correlationId!.length).toBeGreaterThan(0);
      return {};
    });
    await handler({}, { awsRequestId: 'aws-1' } as never, () => undefined);
  });

  it('uses awsRequestId as correlation when event has no headers', async () => {
    const handler = withLambdaObservability(async () => {
      const id = getLoggerContext().correlationId!;
      expect(id).toBe('a');
      return {};
    });
    await handler({}, { awsRequestId: 'a' } as never, () => undefined);
  });

  it('extractCorrelationId reads x-correlation-id header', () => {
    const id = extractCorrelationId({
      headers: { 'x-correlation-id': 'hdr-1' },
    } as never);
    expect(id).toBe('hdr-1');
  });

  it('extractAwsRequestId reads context', () => {
    expect(
      extractAwsRequestId({ awsRequestId: 'rid-1' } as never),
    ).toBe('rid-1');
  });
});
