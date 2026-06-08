import {
  CHANGE_REQUEST_OPERATION,
} from '../models/change-request.types';
import {
  PUBLISH_VERSION_STRATEGY,
  resolvePublishVersionStrategy,
  shouldSyncApplicabilityOnPublish,
} from './publish-version.strategy';

describe('resolvePublishVersionStrategy', () => {
  it('returns NEW_VERSION for Add (creates v1)', () => {
    expect(resolvePublishVersionStrategy(CHANGE_REQUEST_OPERATION.ADD, false)).toBe(
      PUBLISH_VERSION_STRATEGY.NEW_VERSION,
    );
    expect(resolvePublishVersionStrategy(CHANGE_REQUEST_OPERATION.ADD, true)).toBe(
      PUBLISH_VERSION_STRATEGY.NEW_VERSION,
    );
  });

  it('returns IN_PLACE when Update does not require metadata version', () => {
    expect(resolvePublishVersionStrategy(CHANGE_REQUEST_OPERATION.UPDATE, false)).toBe(
      PUBLISH_VERSION_STRATEGY.IN_PLACE,
    );
  });

  it('returns NEW_VERSION when Update requires metadata version', () => {
    expect(resolvePublishVersionStrategy(CHANGE_REQUEST_OPERATION.UPDATE, true)).toBe(
      PUBLISH_VERSION_STRATEGY.NEW_VERSION,
    );
  });
});

describe('shouldSyncApplicabilityOnPublish', () => {
  it('returns false for display-only changes', () => {
    expect(
      shouldSyncApplicabilityOnPublish([
        {
          objectPath: 'MetadataValue.Label',
          operation: 'Update',
          changeKind: 'Any',
          oldValue: 'A',
          newValue: 'B',
        },
      ]),
    ).toBe(false);
  });

  it('returns true when value applicability paths changed', () => {
    expect(
      shouldSyncApplicabilityOnPublish([
        {
          objectPath: 'MetadataValue.ApplicableModules',
          operation: 'Update',
          changeKind: 'Expand',
          oldValue: [],
          newValue: ['CarePlan'],
        },
      ]),
    ).toBe(true);
  });

  it('returns true when type applicableModules changed', () => {
    expect(
      shouldSyncApplicabilityOnPublish([
        {
          objectPath: 'MetadataType.ApplicableModules',
          operation: 'Update',
          changeKind: 'Expand',
          oldValue: [],
          newValue: ['Template'],
        },
      ]),
    ).toBe(true);
  });
});
