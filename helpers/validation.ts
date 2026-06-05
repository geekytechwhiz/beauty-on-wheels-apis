import type { MetadataValueCreatePayload, RegistrySnapshot } from './interfaces';
import { logger } from './logger';

export function registerType(registry: RegistrySnapshot, metadataTypeCode: string): void {
  registry.typesCreated.add(metadataTypeCode);
  if (!registry.valuesByType.has(metadataTypeCode)) {
    registry.valuesByType.set(metadataTypeCode, new Set());
  }
}

export function registerValue(
  registry: RegistrySnapshot,
  metadataTypeCode: string,
  metadataValueCode: string,
): void {
  let set = registry.valuesByType.get(metadataTypeCode);
  if (!set) {
    set = new Set();
    registry.valuesByType.set(metadataTypeCode, set);
  }
  set.add(metadataValueCode);
}

function normalizeToken(raw: string): string {
  return raw.trim().toUpperCase();
}

function hasValueInType(registry: RegistrySnapshot, typeCode: string, valueCode: string): boolean {
  return registry.valuesByType.get(typeCode)?.has(valueCode) ?? false;
}

/**
 * Skips value POST when applicability or relationship targets are not yet in the in-memory snapshot.
 */
export function shouldSkipDueToDependencies(
  name: string,
  payload: MetadataValueCreatePayload,
  registry: RegistrySnapshot,
): boolean {
  const checks: { field: string; typeCode: string; tokens: string[] | undefined }[] = [
    { field: 'ApplicableModule', typeCode: 'ApplicableModule', tokens: payload.applicableModules },
    { field: 'Category', typeCode: 'Category', tokens: payload.applicableCategories },
    { field: 'Condition', typeCode: 'Condition', tokens: payload.applicableConditions },
    { field: 'Country', typeCode: 'Country', tokens: payload.applicableCountries },
    { field: 'Language', typeCode: 'Language', tokens: payload.applicableLanguages },
  ];

  for (const { field, typeCode, tokens } of checks) {
    if (!tokens?.length) {
      continue;
    }
    for (const token of tokens) {
      const code = normalizeToken(token);
      if (!hasValueInType(registry, typeCode, code)) {
        logger.warn('Skipping value — applicability dependency missing', {
          name,
          field,
          token: code,
        });
        return true;
      }
    }
  }

  if (payload.relationships?.length) {
    for (const rel of payload.relationships) {
      const target = rel.targetMetadataValueCode.trim();
      let found = false;
      for (const [, codes] of registry.valuesByType) {
        if (codes.has(target)) {
          found = true;
          break;
        }
      }
      if (!found) {
        logger.warn('Skipping value — relationship target missing', { name, target });
        return true;
      }
    }
  }

  return false;
}
