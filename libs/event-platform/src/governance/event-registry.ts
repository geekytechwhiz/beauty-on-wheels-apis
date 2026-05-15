import type { EventSchemaMeta } from '../core/schema/define-event';
import type { VersionCompatibilityStrategy } from '../core/versioning/version-compatibility';

export type EventClassification = 'domain' | 'integration' | 'audit' | 'command' | 'notification';

export type RegisteredEventDefinition = EventSchemaMeta & {
  ownerTeam?: string;
  classification?: EventClassification;
  compatibility?: VersionCompatibilityStrategy;
  deprecatedVersions?: string[];
};

const registry = new Map<string, RegisteredEventDefinition>();

export function registerEventDefinition(definition: RegisteredEventDefinition): void {
  registry.set(definition.eventType, definition);
}

export function getRegisteredEventDefinition(
  eventType: string,
): RegisteredEventDefinition | undefined {
  return registry.get(eventType);
}

export function listRegisteredEventDefinitions(): RegisteredEventDefinition[] {
  return [...registry.values()];
}

export function clearEventRegistryForTests(): void {
  registry.clear();
}
