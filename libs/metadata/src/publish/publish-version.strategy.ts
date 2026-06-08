import type { DetectedFieldChange } from '../change-policy';
import {
  CHANGE_REQUEST_OPERATION,
  type ChangeRequestOperation,
} from '../models/change-request.types';

export const PUBLISH_VERSION_STRATEGY = {
  IN_PLACE: 'IN_PLACE',
  NEW_VERSION: 'NEW_VERSION',
} as const;

export type PublishVersionStrategy =
  (typeof PUBLISH_VERSION_STRATEGY)[keyof typeof PUBLISH_VERSION_STRATEGY];

/**
 * Add always creates v1 (NEW_VERSION path). Update uses policy-driven selective versioning.
 */
export function resolvePublishVersionStrategy(
  operation: ChangeRequestOperation,
  requiresMetadataVersion: boolean,
): PublishVersionStrategy {
  if (operation === CHANGE_REQUEST_OPERATION.ADD) {
    return PUBLISH_VERSION_STRATEGY.NEW_VERSION;
  }
  return requiresMetadataVersion
    ? PUBLISH_VERSION_STRATEGY.NEW_VERSION
    : PUBLISH_VERSION_STRATEGY.IN_PLACE;
}

const VALUE_APPLICABILITY_PATH_PREFIX = 'MetadataValue.Applicable';
const TYPE_APPLICABILITY_PATH = 'MetadataType.ApplicableModules';

/** Skip APPL row sync when only display-only fields changed (label/description/sortOrder). */
export function shouldSyncApplicabilityOnPublish(changes: DetectedFieldChange[]): boolean {
  return changes.some(
    (change) =>
      change.objectPath.startsWith(VALUE_APPLICABILITY_PATH_PREFIX) ||
      change.objectPath === TYPE_APPLICABILITY_PATH,
  );
}
