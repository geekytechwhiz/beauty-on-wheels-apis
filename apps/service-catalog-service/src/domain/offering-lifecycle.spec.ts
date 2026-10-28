import { BaseError } from '@api-hub/utils';

import {
  assertOfferingStatusTransition,
  isOfferingDiscoverable,
  OFFERING_STATUS,
} from './offering-lifecycle';

describe('offering lifecycle', () => {
  it('marks only published offerings as discoverable', () => {
    expect(isOfferingDiscoverable(OFFERING_STATUS.PUBLISHED)).toBe(true);
    expect(isOfferingDiscoverable(OFFERING_STATUS.DRAFT)).toBe(false);
    expect(isOfferingDiscoverable(OFFERING_STATUS.PAUSED)).toBe(false);
    expect(isOfferingDiscoverable(OFFERING_STATUS.ARCHIVED)).toBe(false);
  });

  it('allows draft to published and archive', () => {
    expect(() => assertOfferingStatusTransition('draft', 'published')).not.toThrow();
    expect(() => assertOfferingStatusTransition('draft', 'archived')).not.toThrow();
  });

  it('rejects republish from archived', () => {
    expect(() => assertOfferingStatusTransition('archived', 'published')).toThrow(BaseError);
  });
});
