import { getLoadedMetadataCatalog } from '../excel/load-metadata-catalog';
import { filterOrderForScope } from './seed-scope';

export const METADATA_TYPE_DEPENDENCY_ORDER = filterOrderForScope(getLoadedMetadataCatalog().typeOrder);
