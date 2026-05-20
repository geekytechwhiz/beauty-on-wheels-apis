import { assertVersionCompatible } from '../core/versioning/version-compatibility';
import { getRegisteredEventDefinition } from './event-registry';

export function enforceRegisteredEventCompatibility(
  eventType: string,
  eventVersion: string,
): void {
  const definition = getRegisteredEventDefinition(eventType);
  if (!definition) {
    return;
  }
  assertVersionCompatible(eventVersion, {
    supportedVersion: definition.eventVersion,
    supportedVersions: [definition.eventVersion],
    strategy: definition.compatibility,
    deprecatedVersions: definition.deprecatedVersions,
  });
}
