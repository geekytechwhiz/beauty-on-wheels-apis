import type { AxiosInstance } from 'axios';

import type { LoadedMetadataCatalog } from '../excel/load-metadata-catalog';
import { loadMetadataCatalogFromExcel } from '../excel/load-metadata-catalog';
import type { RegistrySnapshot, RichValueSeed, SeedRuntimeConfig, SimpleValueSeed } from '../interfaces';
import { getMetadataValuesByTypes } from '../metadata-api';
import { logger } from '../logger';
import { registerValue } from '../validation';

import type { SeedCatalogScope } from './seed-catalog-scope';

const APPLICABILITY_FIELDS = [
  { key: 'applicableModules' as const, typeCode: 'ApplicableModule' },
  { key: 'applicableCategories' as const, typeCode: 'Category' },
  { key: 'applicableConditions' as const, typeCode: 'Condition' },
  { key: 'applicableCountries' as const, typeCode: 'Country' },
  { key: 'applicableLanguages' as const, typeCode: 'Language' },
];

function normalizeApplicabilityToken(raw: string): string {
  return raw.trim().toUpperCase();
}

function addRequirement(
  requirements: Map<string, Set<string>>,
  typeCode: string,
  token: string,
  normalize: boolean,
): void {
  const value = normalize ? normalizeApplicabilityToken(token) : token.trim();
  if (!value) {
    return;
  }
  let set = requirements.get(typeCode);
  if (!set) {
    set = new Set();
    requirements.set(typeCode, set);
  }
  set.add(value);
}

function addApplicabilityFromSeed(
  requirements: Map<string, Set<string>>,
  seed: SimpleValueSeed | RichValueSeed,
): void {
  for (const { key, typeCode } of APPLICABILITY_FIELDS) {
    const tokens = seed[key];
    if (!tokens?.length) {
      continue;
    }
    for (const token of tokens) {
      addRequirement(requirements, typeCode, token, true);
    }
  }
}

/** Builds valueCode → metadataTypeCode from the full Excel catalog. */
export function buildFullCatalogValueTypeIndex(
  catalog: LoadedMetadataCatalog,
): Record<string, string> {
  const index: Record<string, string> = { ...catalog.richValueTypeByCode };
  for (const [typeCode, seeds] of Object.entries(catalog.simpleValuesByType)) {
    for (const seed of seeds) {
      index[seed.metadataValueCode] = typeCode;
    }
  }
  return index;
}

/**
 * Collects prerequisite metadata values referenced by scoped seeds (applicability + relationship targets).
 */
export function collectDependencyRequirements(
  scope: SeedCatalogScope,
  fullCatalogValueTypeByCode: Record<string, string>,
): Map<string, Set<string>> {
  const requirements = new Map<string, Set<string>>();

  for (const typeCode of scope.typeDependencyOrder) {
    for (const seed of scope.simpleValuesByType[typeCode] ?? []) {
      addApplicabilityFromSeed(requirements, seed);
    }
  }

  for (const seed of scope.richValues) {
    addApplicabilityFromSeed(requirements, seed);
    if (!seed.relationships?.length) {
      continue;
    }
    for (const rel of seed.relationships) {
      const target = rel.targetMetadataValueCode.trim();
      if (!target) {
        continue;
      }
      const targetType = fullCatalogValueTypeByCode[target];
      if (targetType) {
        addRequirement(requirements, targetType, target, false);
      } else {
        logger.warn('Relationship target not found in Excel catalog — cannot hydrate', {
          target,
          sourceValue: seed.metadataValueCode,
        });
      }
    }
  }

  return requirements;
}

export interface RegistryHydrationSummary {
  source: 'api' | 'catalog' | 'none';
  typesRequested: string[];
  valuesRegistered: number;
  registeredByType: Record<string, string[]>;
  missingTokens: { typeCode: string; tokens: string[] }[];
}

function summarizeRegistered(registry: RegistrySnapshot, typeCode: string): string[] {
  return [...(registry.valuesByType.get(typeCode) ?? [])].sort();
}

function collectMissingTokens(
  registry: RegistrySnapshot,
  requirements: Map<string, Set<string>>,
): { typeCode: string; tokens: string[] }[] {
  const missing: { typeCode: string; tokens: string[] }[] = [];
  for (const [typeCode, tokens] of requirements) {
    const registered = registry.valuesByType.get(typeCode);
    const notFound = [...tokens].filter((token) => !registered?.has(token));
    if (notFound.length) {
      missing.push({ typeCode, tokens: notFound.sort() });
    }
  }
  return missing;
}

function catalogValueCodesForType(
  catalog: LoadedMetadataCatalog,
  typeCode: string,
): Set<string> {
  const codes = new Set<string>();
  for (const seed of catalog.simpleValuesByType[typeCode] ?? []) {
    codes.add(seed.metadataValueCode);
  }
  for (const seed of catalog.richValues) {
    if (catalog.richValueTypeByCode[seed.metadataValueCode] === typeCode) {
      codes.add(seed.metadataValueCode);
    }
  }
  return codes;
}

function hydrateFromCatalog(
  registry: RegistrySnapshot,
  requirements: Map<string, Set<string>>,
  catalog: LoadedMetadataCatalog,
): RegistryHydrationSummary {
  let valuesRegistered = 0;
  const typeCodes = [...requirements.keys()];

  for (const [typeCode, tokens] of requirements) {
    const catalogCodes = catalogValueCodesForType(catalog, typeCode);
    for (const token of tokens) {
      const applicabilityMatch = catalogCodes.has(token)
        ? token
        : [...catalogCodes].find((code) => normalizeApplicabilityToken(code) === token);
      if (applicabilityMatch) {
        registerValue(registry, typeCode, applicabilityMatch);
        valuesRegistered++;
      }
    }
  }

  const registeredByType: Record<string, string[]> = {};
  for (const typeCode of typeCodes) {
    const codes = summarizeRegistered(registry, typeCode);
    if (codes.length) {
      registeredByType[typeCode] = codes;
    }
  }

  const missingTokens = collectMissingTokens(registry, requirements);
  if (missingTokens.length) {
    logger.warn('[seed] Some dependency tokens missing from Excel catalog (dry-run hydration)', {
      missingTokens,
    });
  }

  return {
    source: 'catalog',
    typesRequested: typeCodes,
    valuesRegistered,
    registeredByType,
    missingTokens,
  };
}

async function hydrateFromApi(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  registry: RegistrySnapshot,
  requirements: Map<string, Set<string>>,
): Promise<RegistryHydrationSummary> {
  const typeCodes = [...requirements.keys()];
  const result = await getMetadataValuesByTypes(client, config, typeCodes);
  let valuesRegistered = 0;

  if (result.missingMetadataTypeCodes.length) {
    logger.warn('[seed] Prerequisite metadata types not found in API', {
      missingMetadataTypeCodes: result.missingMetadataTypeCodes,
    });
  }

  for (const item of result.items) {
    const needed = requirements.get(item.metadataType);
    if (!needed?.size) {
      continue;
    }

    const apiCodes = new Map<string, string>();
    for (const value of item.values) {
      const code = (value.valueCode ?? value.metadataValueCode ?? '').trim();
      if (code) {
        apiCodes.set(code, code);
        apiCodes.set(normalizeApplicabilityToken(code), code);
      }
    }

    for (const token of needed) {
      const resolved = apiCodes.get(token);
      if (resolved) {
        registerValue(registry, item.metadataType, resolved);
        valuesRegistered++;
      }
    }
  }

  const registeredByType: Record<string, string[]> = {};
  for (const typeCode of typeCodes) {
    const codes = summarizeRegistered(registry, typeCode);
    if (codes.length) {
      registeredByType[typeCode] = codes;
    }
  }

  const missingTokens = collectMissingTokens(registry, requirements);
  if (missingTokens.length) {
    logger.warn('[seed] Some dependency tokens not found in API', { missingTokens });
  }

  return {
    source: 'api',
    typesRequested: typeCodes,
    valuesRegistered,
    registeredByType,
    missingTokens,
  };
}

function logHydrationSummary(summary: RegistryHydrationSummary): void {
  if (summary.source === 'none') {
    return;
  }

  console.log(
    `[seed] Registry hydrated (${summary.source}): ${summary.valuesRegistered} dependency value(s)`,
  );
  for (const typeCode of summary.typesRequested) {
    const tokens = summary.registeredByType[typeCode];
    if (tokens?.length) {
      console.log(`[seed]   ${typeCode}: ${tokens.join(', ')}`);
    }
  }
  if (summary.missingTokens.length) {
    for (const { typeCode, tokens } of summary.missingTokens) {
      console.log(`[seed]   ${typeCode} (missing): ${tokens.join(', ')}`);
    }
  }
}

/**
 * In scoped seed mode, loads existing dependency values from the API into the in-memory registry
 * so Phase 2/3 skip checks pass without listing prerequisite types in METADATA_TYPE_CODES.
 */
export async function hydrateRegistryForScopedSeed(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  registry: RegistrySnapshot,
  scope: SeedCatalogScope,
): Promise<RegistryHydrationSummary> {
  if (scope.mode !== 'SCOPED') {
    return {
      source: 'none',
      typesRequested: [],
      valuesRegistered: 0,
      registeredByType: {},
      missingTokens: [],
    };
  }

  const fullCatalog = loadMetadataCatalogFromExcel();
  const fullValueTypeByCode = buildFullCatalogValueTypeIndex(fullCatalog);
  const requirements = collectDependencyRequirements(scope, fullValueTypeByCode);
  const typeCodes = [...requirements.keys()];

  if (!typeCodes.length) {
    logger.info('[seed] No registry dependencies to hydrate for scoped seed');
    return {
      source: 'none',
      typesRequested: [],
      valuesRegistered: 0,
      registeredByType: {},
      missingTokens: [],
    };
  }

  logger.info('[seed] Hydrating registry dependencies for scoped seed', {
    types: typeCodes,
    tokensByType: Object.fromEntries(
      [...requirements.entries()].map(([typeCode, tokens]) => [typeCode, [...tokens].sort()]),
    ),
  });

  const summary = config.dryRun
    ? hydrateFromCatalog(registry, requirements, fullCatalog)
    : await hydrateFromApi(client, config, registry, requirements);

  logHydrationSummary(summary);
  return summary;
}
