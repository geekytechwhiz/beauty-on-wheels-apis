import {
  createChildLogger,
  createLogger,
  createPerformanceTimer,
  extractAwsRequestId,
  getLoggerContext,
  logHttpRequest,
  redactPII,
  serializeError,
  withLoggerContext,
} from './logger/index.js';

describe('observability logger module', () => {
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
    expect(serialized.stack).toContain('Error: boom');
  });

  it('redacts pii recursively', () => {
    const data = {
      email: 'user@site.com',
      nested: {
        authorization: 'Bearer token',
      },
      items: [{ phone: '+10000000000' }],
    };

    expect(redactPII(data)).toEqual({
      email: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
      items: [{ phone: '[REDACTED]' }],
    });
  });

  it('creates child logger while preserving compatibility context keys', () => {
    const parent = createLogger();
    const child = createChildLogger(parent, { organizationId: 'org-1' });
    expect(child.getContext()).toMatchObject({
      organizationId: 'org-1',
    });
  });

  it('logs http request and performance timer outputs', () => {
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

    const timer = createPerformanceTimer(testLogger, 'db-query');
    timer.end();

    expect(info).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('extracts aws request id', () => {
    const awsRequestId = extractAwsRequestId({
      awsRequestId: 'aws-1',
    } as never);
    expect(awsRequestId).toBe('aws-1');
  });
});
