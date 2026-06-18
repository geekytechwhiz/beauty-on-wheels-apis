import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { configureEventRuntime, resetEventRuntimeForTests } from './event-runtime';

describe('event-runtime', () => {
  const originalEventBus = process.env.EVENT_BUS;

  beforeEach(() => {
    resetEventRuntimeForTests();
    process.env.EVENT_BUS = 'organization-service-bus-dev';
  });

  afterEach(() => {
    if (originalEventBus === undefined) {
      delete process.env.EVENT_BUS;
    } else {
      process.env.EVENT_BUS = originalEventBus;
    }
    resetEventRuntimeForTests();
  });

  it('configures EventBridge runtime once without error', () => {
    expect(() => configureEventRuntime()).not.toThrow();
    expect(() => configureEventRuntime()).not.toThrow();
  });

  it('throws when EVENT_BUS is missing', () => {
    delete process.env.EVENT_BUS;
    expect(() => configureEventRuntime()).toThrow('EVENT_BUS is not configured');
  });
});
