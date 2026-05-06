import type { DlqConfig } from './dlq-config';
import {
  classifyAfterHandlerFailure,
  decideDeliveryDisposition,
  outcomeWhenExhausted,
  resolveDeliveryDecision,
} from './delivery-decision';
import { ZodError } from 'zod';

describe('classifyAfterHandlerFailure', () => {
  it('returns retry when more attempts remain', () => {
    expect(classifyAfterHandlerFailure({ failedAttemptNumber: 1, maxAttempts: 3 })).toBe(
      'retry',
    );
    expect(classifyAfterHandlerFailure({ failedAttemptNumber: 2, maxAttempts: 3 })).toBe(
      'retry',
    );
  });

  it('returns exhausted on the last failed attempt', () => {
    expect(classifyAfterHandlerFailure({ failedAttemptNumber: 3, maxAttempts: 3 })).toBe(
      'exhausted',
    );
  });
});

describe('outcomeWhenExhausted', () => {
  it('prefers DLQ candidate reporting when enabled', () => {
    const dlq: DlqConfig = { enabled: true };
    expect(outcomeWhenExhausted(dlq)).toBe('dead_letter_candidate');
  });

  it('propagates error when DLQ awareness is off', () => {
    const dlq: DlqConfig = { enabled: false };
    expect(outcomeWhenExhausted(dlq)).toBe('propagate_error');
  });
});

describe('decideDeliveryDisposition', () => {
  it('yields dead_letter_candidate after max retries when DLQ is enabled', () => {
    expect(
      decideDeliveryDisposition({
        failedAttemptNumber: 3,
        maxAttempts: 3,
        dlq: { enabled: true },
      }),
    ).toBe('dead_letter_candidate');
  });

  it('yields propagate_error after max retries when DLQ is disabled', () => {
    expect(
      decideDeliveryDisposition({
        failedAttemptNumber: 3,
        maxAttempts: 3,
        dlq: { enabled: false },
      }),
    ).toBe('propagate_error');
  });

  it('yields retry before attempts are exhausted', () => {
    expect(
      decideDeliveryDisposition({
        failedAttemptNumber: 1,
        maxAttempts: 3,
        dlq: { enabled: true },
      }),
    ).toBe('retry');
  });
});

describe('resolveDeliveryDecision', () => {
  it('routes non-retryable errors to dead-letter immediately when DLQ has a strategy', () => {
    const d = resolveDeliveryDecision({
      effectiveAttempt: 1,
      maxAttempts: 5,
      dlq: { enabled: true, strategy: { send: async () => { /* empty */ } } },
      error: new ZodError([]),
      allowTransportRetry: true,
    });
    expect(d.type).toBe('dead_letter');
    expect(d).toMatchObject({ reason: 'non_retryable_error' });
  });

  it('returns discard on non-retryable errors when DLQ strategy is absent', () => {
    const d = resolveDeliveryDecision({
      effectiveAttempt: 1,
      maxAttempts: 5,
      dlq: { enabled: false },
      error: new ZodError([]),
      allowTransportRetry: true,
    });
    expect(d.type).toBe('discard');
    expect(d).toMatchObject({ reason: 'non_retryable_error' });
  });

  it('requests transport retry while attempts remain for retryable errors', () => {
    const d = resolveDeliveryDecision({
      effectiveAttempt: 1,
      maxAttempts: 3,
      dlq: { enabled: true },
      error: new Error('boom'),
      allowTransportRetry: true,
    });
    expect(d.type).toBe('retry');
  });
});
