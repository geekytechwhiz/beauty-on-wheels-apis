import type { MetadataTypeSeedDefinition } from '../../interfaces';
import { getLoadedMetadataCatalog } from '../../excel/load-metadata-catalog';
import { filterTypesForScope } from '../seed-scope';

export const METADATA_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = filterTypesForScope(
  getLoadedMetadataCatalog().typeDefinitions,
);
