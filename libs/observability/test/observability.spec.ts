jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import { Logger as PowertoolsCtor } from '@aws-lambda-powertools/logger';

import {
  createChildLogger,
  createLogger,
  getLoggerContext,
  initObservability,
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
  const last = (PowertoolsCtor as jest.Mock).mock.results.at(-1)?.value;
  if (!last) {
    throw new Error('Powertools Logger mock not instantiated');
  }
  return last;
};

describe('@api-hub/observability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initObservability({
      serviceName: 'jest-observability',
      logLevel: 'DEBUG',
      sampling: { info: 1, debug: 1 },
      redactPII: false,
      enforceLogPolicy: false,
    });
  });

  it('propagates logger context across async boundaries', async () => {
    await withLoggerContext(
      { correlationId: 'corr-1', tenantId: 'tenant-1' },
      async () => {
        await Promise.resolve();
        expect(getLoggerContext()).toMatchObject({
          correlationId: 'corr-1',
          tenantId: 'tenant-1',
          organizationId: 'tenant-1',
        });
      }
    );
  });

  it('serializes errors with stack information', () => {
    const err = new Error('boom');
    const serialized = serializeError(err);
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('boom');
    expect(String(serialized.stack)).toContain('boom');
  });

  it('creates child logger sharing Powertools instance', () => {
    const parent = createLogger();
    const child = createChildLogger(parent, { organizationId: 'org-1' });
    expect(child.getContext()).toMatchObject({
      organizationId: 'org-1',
    });
    expect(getPowertoolsMock()).toBeDefined();
  });

  it('logs http request via controlled API', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const error = jest.fn();
    const testLogger = { info, warn, error };

    logHttpRequest(testLogger, {
      method: 'GET',
      path: '/health',
      statusCode: 200,
      duration: 12,
      correlationId: 'corr-2',
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('filters DEBUG when log level is ERROR', () => {
    initObservability({
      serviceName: 'jest-observability',
      logLevel: 'ERROR',
      sampling: { info: 1, debug: 1 },
      redactPII: false,
      enforceLogPolicy: false,
    });
    const log = createLogger();
    const pt = getPowertoolsMock();
    log.debug('should not emit');
    expect(pt.debug).not.toHaveBeenCalled();
    log.error('should emit');
    expect(pt.error).toHaveBeenCalled();
  });

  it('samples INFO using Math.random', () => {
    initObservability({
      serviceName: 'jest-observability',
      logLevel: 'INFO',
      sampling: { info: 0.3, debug: 0 },
      redactPII: false,
      enforceLogPolicy: false,
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const log = createLogger();
    const pt = getPowertoolsMock();
    log.info({ event: 'e', message: 'm' });
    expect(pt.info).not.toHaveBeenCalled();
    randomSpy.mockReturnValue(0.2);
    log.info({ event: 'e2', message: 'm2' });
    expect(pt.info).toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('blocks request/response keys when policy is enforced', () => {
    initObservability({
      serviceName: 'jest-observability',
      logLevel: 'INFO',
      sampling: { info: 1, debug: 1 },
      redactPII: false,
      enforceLogPolicy: true,
    });
    const log = createLogger();
    const pt = getPowertoolsMock();
    log.info({
      event: 'with_payload',
      message: 'hello',
      request: { body: 'secret' },
    });
    expect(pt.info).toHaveBeenCalledTimes(1);
    const payload = pt.info.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.request).toBe('[BLOCKED]');
    expect(payload.logPolicyWarning).toContain('not allowed');
  });

  it('drops logs missing required structured fields when enforcement is on', () => {
    initObservability({
      serviceName: 'jest-observability',
      logLevel: 'INFO',
      sampling: { info: 1, debug: 1 },
      redactPII: false,
      enforceLogPolicy: true,
    });
    const log = createLogger();
    const pt = getPowertoolsMock();
    log.info({ message: 'only message' } as never);
    expect(pt.info).not.toHaveBeenCalled();
  });

  it('redacts PII in structured payloads when enabled', () => {
    initObservability({
      serviceName: 'jest-observability',
      logLevel: 'INFO',
      sampling: { info: 1, debug: 1 },
      redactPII: true,
      enforceLogPolicy: false,
    });
    const log = createLogger();
    const pt = getPowertoolsMock();
    log.info({
      event: 'x',
      message: 'm',
      nested: { email: 'a@b.co' },
    });
    const payload = pt.info.mock.calls[0][1] as Record<string, unknown>;
    expect((payload.nested as { email: string }).email).toBe('[REDACTED]');
  });

  it('withLambdaObservability sets ALS context', async () => {
    const handler = withLambdaObservability(async () => {
      const ctx = getLoggerContext();
      expect(ctx.awsRequestId).toBe('aws-1');
      expect(typeof ctx.correlationId).toBe('string');
      expect(ctx.correlationId!.length).toBeGreaterThan(10);
      return {};
    });
    await handler(
      {},
      { awsRequestId: 'aws-1' } as never,
      () => undefined
    );
  });

  it('generates UUID correlation id when event has no headers', async () => {
    const handler = withLambdaObservability(async () => {
      const id = getLoggerContext().correlationId!;
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      return {};
    });
    await handler({}, { awsRequestId: 'a' } as never, () => undefined);
  });
});
