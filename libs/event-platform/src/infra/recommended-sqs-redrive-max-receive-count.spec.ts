import { recommendedSqsRedriveMaxReceiveCount } from './recommended-sqs-redrive-max-receive-count';

describe('recommendedSqsRedriveMaxReceiveCount', () => {
  it('matches consumer maxAttempts with a minimum of 1', () => {
    expect(
      recommendedSqsRedriveMaxReceiveCount({
        retry: {
          maxAttempts: 3,
          strategy: 'exponential',
          delayMs: 200,
        },
      }),
    ).toBe(3);
    expect(
      recommendedSqsRedriveMaxReceiveCount({
        retry: {
          maxAttempts: 0,
          strategy: 'fixed',
          delayMs: 100,
        },
      }),
    ).toBe(1);
  });
});
