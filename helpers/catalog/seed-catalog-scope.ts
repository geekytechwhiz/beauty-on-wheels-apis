import {
  METADATA_RICH_VALUES,
  METADATA_TYPE_DEFINITIONS,
  METADATA_TYPE_DEPENDENCY_ORDER,
  METADATA_VALUE_CATALOG,
  RICH_VALUE_TYPE_BY_CODE,
} from '../constants';
import { loadMetadataCatalogFromExcel } from '../excel/load-metadata-catalog';
import type { MetadataTypeSeedDefinition, RichValueSeed, SimpleValueSeed } from '../interfaces';
import { logger } from '../logger';

export type SeedMode = 'FULL' | 'SCOPED';

export interface SeedCatalogScope {
  mode: SeedMode;
  selectedTypeCodes: string[];
  typeDependencyOrder: string[];
  typeDefinitions: MetadataTypeSeedDefinition[];
  simpleValuesByType: Record<string, SimpleValueSeed[]>;
  richValues: RichValueSeed[];
  richValueTypeByCode: Record<string, string>;
}

/** Returns selected type codes in env order, or `null` for full seed mode. */
export function parseMetadataTypeCodesList(): string[] | null {
  const raw = process.env.METADATA_TYPE_CODES?.trim();
  if (!raw) {
    return null;
  }
  const codes = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  return codes.length ? codes : null;
}

/** Returns selected type codes as a set, or `null` for full seed mode. */
export function parseMetadataTypeCodesFilter(): Set<string> | null {
  const codes = parseMetadataTypeCodesList();
  return codes ? new Set(codes) : null;
}

export function countSeedValues(scope: SeedCatalogScope): number {
  let simple = 0;
  for (const typeCode of scope.typeDependencyOrder) {
    simple += scope.simpleValuesByType[typeCode]?.length ?? 0;
  }
  return simple + scope.richValues.length;
}

function buildFullSeedCatalogScope(): SeedCatalogScope {
  return {
    mode: 'FULL',
    selectedTypeCodes: [],
    typeDependencyOrder: [...METADATA_TYPE_DEPENDENCY_ORDER],
    typeDefinitions: [...METADATA_TYPE_DEFINITIONS],
    simpleValuesByType: { ...METADATA_VALUE_CATALOG },
    richValues: [...METADATA_RICH_VALUES],
    richValueTypeByCode: { ...RICH_VALUE_TYPE_BY_CODE },
  };
}

function buildScopedSeedCatalogScope(filter: Set<string>, selectedTypeCodes: string[]): SeedCatalogScope {
  const catalog = loadMetadataCatalogFromExcel();

  const missing = selectedTypeCodes.filter((code) => !catalog.typeOrder.includes(code));
  if (missing.length) {
    logger.warn('Selected metadata types not found in Excel catalog — skipping', { missing });
  }

  const typeDependencyOrder = catalog.typeOrder.filter((code) => filter.has(code));
  const typeDefinitions = catalog.typeDefinitions.filter((def) =>
    filter.has(def.metadataTypeCode),
  );

  const simpleValuesByType: Record<string, SimpleValueSeed[]> = {};
  for (const typeCode of typeDependencyOrder) {
    const seeds = catalog.simpleValuesByType[typeCode];
    if (seeds?.length) {
      simpleValuesByType[typeCode] = seeds;
    }
  }

  const richValues = catalog.richValues.filter((seed) =>
    filter.has(catalog.richValueTypeByCode[seed.metadataValueCode] ?? ''),
  );

  const richValueTypeByCode: Record<string, string> = {};
  for (const seed of richValues) {
    const typeCode = catalog.richValueTypeByCode[seed.metadataValueCode];
    if (typeCode) {
      richValueTypeByCode[seed.metadataValueCode] = typeCode;
    }
  }

  return {
    mode: 'SCOPED',
    selectedTypeCodes,
    typeDependencyOrder,
    typeDefinitions,
    simpleValuesByType,
    richValues,
    richValueTypeByCode,
  };
}

export function resolveSeedCatalogScope(): SeedCatalogScope {
  const selectedTypeCodes = parseMetadataTypeCodesList();
  if (!selectedTypeCodes) {
    return buildFullSeedCatalogScope();
  }
  return buildScopedSeedCatalogScope(new Set(selectedTypeCodes), selectedTypeCodes);
}

export function logSeedCatalogScope(scope: SeedCatalogScope): void {
  if (scope.mode === 'FULL') {
    console.log('[seed] Mode: FULL');
    console.log('[seed] Processing all metadata types');
    return;
  }

  console.log('[seed] Mode: SCOPED');
  console.log(`[seed] Selected metadata types: ${scope.selectedTypeCodes.join(', ')}`);
  console.log(`[seed] Filtered metadata types: ${scope.typeDependencyOrder.length}`);
  console.log(`[seed] Filtered metadata values: ${countSeedValues(scope)}`);
}
