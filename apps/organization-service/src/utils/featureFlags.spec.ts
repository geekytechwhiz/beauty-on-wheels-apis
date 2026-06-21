import { afterEach, describe, expect, it } from '@jest/globals';
import { isNewOrgConfigFlowEnabled } from './featureFlags';

describe('featureFlags', () => {
  const original = process.env.ENABLE_NEW_ORG_CONFIG_FLOW;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ENABLE_NEW_ORG_CONFIG_FLOW;
    } else {
      process.env.ENABLE_NEW_ORG_CONFIG_FLOW = original;
    }
  });

  it('defaults to false when unset', () => {
    delete process.env.ENABLE_NEW_ORG_CONFIG_FLOW;
    expect(isNewOrgConfigFlowEnabled()).toBe(false);
  });

  it('returns true for true/1', () => {
    process.env.ENABLE_NEW_ORG_CONFIG_FLOW = 'true';
    expect(isNewOrgConfigFlowEnabled()).toBe(true);
    process.env.ENABLE_NEW_ORG_CONFIG_FLOW = '1';
    expect(isNewOrgConfigFlowEnabled()).toBe(true);
  });

  it('returns false for false/0', () => {
    process.env.ENABLE_NEW_ORG_CONFIG_FLOW = 'false';
    expect(isNewOrgConfigFlowEnabled()).toBe(false);
    process.env.ENABLE_NEW_ORG_CONFIG_FLOW = '0';
    expect(isNewOrgConfigFlowEnabled()).toBe(false);
  });
});
