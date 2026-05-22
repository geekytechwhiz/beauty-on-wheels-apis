import objectPath from 'object-path';

import type { ExtensionMapping } from '../registry/mapping.registry';

export type FhirExtension = {
  url: string;
  [key: string]: unknown;
};

function buildExtensionValue(
  value: unknown,
  valueType: ExtensionMapping['valueType'],
): Record<string, unknown> {
  switch (valueType) {
    case 'boolean':
      return { valueBoolean: Boolean(value) };
    case 'integer':
      return { valueInteger: Number(value) };
    case 'date':
      return { valueDate: String(value) };
    case 'code':
      return { valueCode: String(value) };
    case 'json':
      return {
        valueString:
          typeof value === 'string' ? value : JSON.stringify(value),
      };
    case 'string':
    default:
      return { valueString: String(value) };
  }
}

/**
 * Builds FHIR Extension entries from canonical source paths.
 * Skips null/undefined values and deduplicates by extension URL.
 */
export function buildExtensions(
  canonical: Record<string, unknown>,
  extensionMappings: ExtensionMapping[] | undefined,
): FhirExtension[] {
  if (!extensionMappings?.length) {
    return [];
  }

  const byUrl = new Map<string, FhirExtension>();

  for (const mapping of extensionMappings) {
    const value = objectPath.get(canonical, mapping.source);

    if (value === undefined || value === null) {
      continue;
    }

    byUrl.set(mapping.url, {
      url: mapping.url,
      ...buildExtensionValue(value, mapping.valueType),
    });
  }

  return Array.from(byUrl.values());
}

/**
 * Merges newly built extensions with any existing extension array on the resource.
 * New entries override existing ones with the same URL.
 */
export function mergeExtensions(
  existing: FhirExtension[] | undefined,
  built: FhirExtension[],
): FhirExtension[] {
  if (!built.length && !existing?.length) {
    return [];
  }

  const byUrl = new Map<string, FhirExtension>();

  for (const ext of existing ?? []) {
    if (ext.url) {
      byUrl.set(ext.url, ext);
    }
  }

  for (const ext of built) {
    byUrl.set(ext.url, ext);
  }

  return Array.from(byUrl.values());
}
