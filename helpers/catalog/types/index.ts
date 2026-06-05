import type { MetadataTypeSeedDefinition } from '../../interfaces';
import { filterTypesForScope } from '../seed-scope';
import { COMPLEX_TYPE_DEFINITIONS } from './complex';
import { FOUNDATIONAL_TYPE_DEFINITIONS } from './foundational';
import { GEOGRAPHY_TYPE_DEFINITIONS } from './geography';
import { MODULE_SCOPED_TYPE_DEFINITIONS } from './module-scoped';
import { TEMPLATE_TYPE_DEFINITIONS } from './template';

const ALL_METADATA_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = [
  ...FOUNDATIONAL_TYPE_DEFINITIONS,
  ...GEOGRAPHY_TYPE_DEFINITIONS,
  ...TEMPLATE_TYPE_DEFINITIONS,
  ...MODULE_SCOPED_TYPE_DEFINITIONS,
  ...COMPLEX_TYPE_DEFINITIONS,
];

export const METADATA_TYPE_DEFINITIONS = filterTypesForScope(ALL_METADATA_TYPE_DEFINITIONS);
