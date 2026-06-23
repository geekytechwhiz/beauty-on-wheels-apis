import { createDefaultSqsDlqStrategy } from '@api-hub/event-platform';

import {
  buildTaskEventConsumerDeps,
  resetTaskEventConsumerDepsCache,
} from './event-consumer-deps';

jest.mock('@api-hub/event-platform', () => {
  const actual = jest.requireActual<typeof import('@api-hub/event-platform')>('@api-hub/event-platform');
  return {
    ...actual,
    createDefaultSqsDlqStrategy: jest.fn(),
  };
});

const mockCreateDefaultSqsDlqStrategy = createDefaultSqsDlqStrategy as jest.MockedFunction<
  typeof createDefaultSqsDlqStrategy
>;

describe('event-consumer-deps', () => {
  afterEach(() => {
    resetTaskEventConsumerDepsCache();
    mockCreateDefaultSqsDlqStrategy.mockReset();
  });

  it('enables dlq when default strategy is available', () => {
    const strategy = { send: jest.fn() };
    mockCreateDefaultSqsDlqStrategy.mockReturnValue(strategy as never);
    const deps = buildTaskEventConsumerDeps();
    expect(deps).toMatchObject({ dlq: { enabled: true, strategy } });
    expect(buildTaskEventConsumerDeps()).toBe(deps);
  });

  it('disables dlq when strategy factory returns undefined', () => {
    mockCreateDefaultSqsDlqStrategy.mockReturnValue(undefined);
    resetTaskEventConsumerDepsCache();
    const deps = buildTaskEventConsumerDeps();
    expect(deps).toMatchObject({ dlq: { enabled: false } });
  });
});
