import type { LoadedMetadataCatalog } from '../excel/load-metadata-catalog';
import type { MetadataTypeSeedDefinition } from '../interfaces';

const SKIP_TYPE_CODES = new Set(['ApplicableModule']);

function normalizeModules(modules: string[] | undefined): string[] {
  if (!modules?.length) {
    return [];
  }
  return [...new Set(modules.map((token) => token.trim().toUpperCase()).filter(Boolean))].sort();
}

/** Union of `applicableModules` referenced by simple + rich value seeds, per metadata type. */
export function aggregateApplicableModulesByType(
  catalog: LoadedMetadataCatalog,
): Record<string, string[]> {
  const buckets = new Map<string, Set<string>>();

  const add = (typeCode: string, modules: string[] | undefined) => {
    if (!modules?.length || SKIP_TYPE_CODES.has(typeCode)) {
      return;
    }
    let set = buckets.get(typeCode);
    if (!set) {
      set = new Set();
      buckets.set(typeCode, set);
    }
    for (const moduleCode of modules) {
      set.add(moduleCode.trim().toUpperCase());
    }
  };

  for (const [typeCode, seeds] of Object.entries(catalog.simpleValuesByType)) {
    for (const seed of seeds) {
      add(typeCode, seed.applicableModules);
    }
  }

  for (const seed of catalog.richValues) {
    const typeCode = catalog.richValueTypeByCode[seed.metadataValueCode];
    if (typeCode) {
      add(typeCode, seed.applicableModules);
    }
  }

  const out: Record<string, string[]> = {};
  for (const [typeCode, set] of buckets) {
    out[typeCode] = [...set].sort();
  }
  return out;
}

export function modulesEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return normalizeModules(a).join(',') === normalizeModules(b).join(',');
}

/**
 * Target type-level modules: union of catalog override (if any) and all value-referenced modules.
 */
export function resolveTargetTypeModules(
  def: MetadataTypeSeedDefinition,
  fromValues: string[] | undefined,
): string[] {
  if (SKIP_TYPE_CODES.has(def.metadataTypeCode)) {
    return [];
  }
  const merged = new Set<string>([
    ...normalizeModules(def.applicableModules),
    ...normalizeModules(fromValues),
  ]);
  return [...merged].sort();
}

export function enrichTypeDefinitionWithModules(
  def: MetadataTypeSeedDefinition,
  targetModules: string[],
): MetadataTypeSeedDefinition {
  if (!targetModules.length) {
    return def;
  }
  return {
    ...def,
    applicableModules: targetModules,
    valueApplicabilityConfig: {
      ...def.valueApplicabilityConfig,
      moduleScoped: true,
    },
  };
}

export interface TypeModuleBackfillPlan {
  metadataTypeCode: string;
  targetModules: string[];
  definition: MetadataTypeSeedDefinition;
}

/** Types that need a type-level module update (non-empty target modules). */
export function buildTypeModuleBackfillPlan(catalog: LoadedMetadataCatalog): TypeModuleBackfillPlan[] {
  const fromValuesByType = aggregateApplicableModulesByType(catalog);
  const plans: TypeModuleBackfillPlan[] = [];

  for (const def of catalog.typeDefinitions) {
    const targetModules = resolveTargetTypeModules(def, fromValuesByType[def.metadataTypeCode]);
    if (!targetModules.length) {
      continue;
    }
    plans.push({
      metadataTypeCode: def.metadataTypeCode,
      targetModules,
      definition: enrichTypeDefinitionWithModules(def, targetModules),
    });
  }

  return plans;
}

/**
 * Merges type-level `applicableModules` from code overrides, Excel type headers, and all value rows.
 * Used at catalog load time so Phase 1 seed creates types with correct modules (no backfill needed).
 */
export function enrichCatalogTypeDefinitions(
  catalog: LoadedMetadataCatalog,
): MetadataTypeSeedDefinition[] {
  const fromValuesByType = aggregateApplicableModulesByType(catalog);
  return catalog.typeDefinitions.map((def) => {
    const targetModules = resolveTargetTypeModules(def, fromValuesByType[def.metadataTypeCode]);
    return enrichTypeDefinitionWithModules(def, targetModules);
  });
}
