import type { RichValueSeed, SimpleValueSeed } from '../../interfaces';
import { getLoadedMetadataCatalog } from '../../excel/load-metadata-catalog';
import { filterValueCatalogForScope, isSmokeTestEnabled } from '../seed-scope';

const catalog = getLoadedMetadataCatalog();

/** Simple values seeded in phase 2 (no relationships / valueAttributes). */
export const METADATA_VALUE_CATALOG: Record<string, SimpleValueSeed[]> = filterValueCatalogForScope(
  catalog.simpleValuesByType,
) as Record<string, SimpleValueSeed[]>;

export const METADATA_RICH_VALUES: RichValueSeed[] = isSmokeTestEnabled() ? [] : catalog.richValues;

export const RICH_VALUE_TYPE_BY_CODE: Record<string, string> = isSmokeTestEnabled()
  ? {}
  : catalog.richValueTypeByCode;
