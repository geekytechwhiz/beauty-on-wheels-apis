/**
 * @jest-environment node
 */
import { ConsoleDlqStrategy } from '../core/dlq/console.strategy';
import { SqsDlqStrategy } from '../core/dlq/sqs-dlq.strategy';
import {
  buildSqsRedrivePolicyFragment,
  createDefaultSqsDlqStrategy,
  resolveConsumerDlqStrategy,
  validateConsumerDlqConfig,
} from './dlq-integration';

describe('dlq-integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateConsumerDlqConfig', () => {
    it('warns when dlq enabled without strategy in test env', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      validateConsumerDlqConfig({ dlq: { enabled: true } });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('throws in strict mode', () => {
      expect(() =>
        validateConsumerDlqConfig({ dlq: { enabled: true } }, { strict: true }),
      ).toThrow(/dlq.strategy is missing/);
    });
  });

  describe('createDefaultSqsDlqStrategy', () => {
    it('returns undefined when no queue URL is configured', () => {
      delete process.env.DLQ_QUEUE_URL;
      delete process.env.EVENT_DLQ_QUEUE_URL;
      expect(createDefaultSqsDlqStrategy()).toBeUndefined();
    });

    it('creates strategy from env', () => {
      process.env.DLQ_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/dlq';
      expect(createDefaultSqsDlqStrategy()).toBeInstanceOf(SqsDlqStrategy);
    });
  });

  describe('resolveConsumerDlqStrategy', () => {
    it('prefers explicit strategy', () => {
      const custom = new ConsoleDlqStrategy();
      expect(resolveConsumerDlqStrategy({ strategy: custom })).toBe(custom);
    });
  });

  describe('buildSqsRedrivePolicyFragment', () => {
    it('aligns maxReceiveCount with retry maxAttempts', () => {
      const fragment = buildSqsRedrivePolicyFragment({
        consumer: { retry: { maxAttempts: 3, strategy: 'fixed', delayMs: 1 } },
        deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123:dlq',
        buffer: 1,
      });
      expect(fragment.maxReceiveCount).toBe(4);
    });
  });
});
