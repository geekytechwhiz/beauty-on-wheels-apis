import type { DlqConfig } from '../dlq/dlq-config';
import { evaluateDeliveryPolicy } from './delivery-policy';
import { ZodError } from 'zod';

describe('evaluateDeliveryPolicy', () => {
  const dlqOn: DlqConfig = { enabled: true, strategy: { send: async () => { /* empty */ } } };

  it('returns retry for sqs-native params same as default when attempts remain', () => {
    const d = evaluateDeliveryPolicy({
      effectiveAttempt: 1,
      maxAttempts: 3,
      dlq: dlqOn,
      error: new Error('boom'),
      allowTransportRetry: true,
      transportMode: 'sqs-native',
    });
    expect(d.type).toBe('retry');
  });

  it('returns discard for non-retryable when DLQ strategy is absent', () => {
    const d = evaluateDeliveryPolicy({
      effectiveAttempt: 1,
      maxAttempts: 5,
      dlq: { enabled: false },
      error: new ZodError([]),
      allowTransportRetry: true,
      transportMode: 'framework-managed',
    });
    expect(d.type).toBe('discard');
  });

  it('handles idempotency contention exhaustion to dead_letter when DLQ enabled', () => {
    const d = evaluateDeliveryPolicy({
      effectiveAttempt: 9,
      maxAttempts: 3,
      dlq: dlqOn,
      allowTransportRetry: true,
      idempotencyContention: true,
    });
    expect(d.type).toBe('dead_letter');
    expect(d).toMatchObject({ reason: 'idempotency_contention_exhausted' });
  });

  it('maps framework-managed transport flag without changing retry matrix', () => {
    expect(
      evaluateDeliveryPolicy({
        effectiveAttempt: 1,
        maxAttempts: 2,
        dlq: { enabled: false },
        error: new Error('x'),
        allowTransportRetry: true,
        transportMode: 'eventbridge',
      }).type,
    ).toBe('retry');
  });
});
