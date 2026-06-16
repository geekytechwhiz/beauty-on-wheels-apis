import { filterTypesForScope, filterValueCatalogForScope, METADATA_SEED_SMOKE_TEST } from '../helpers/catalog/seed-scope';
import { getLoadedMetadataCatalog } from '../helpers/excel/load-metadata-catalog';

const c = getLoadedMetadataCatalog();
let fullSimple = 0;
for (const seeds of Object.values(c.simpleValuesByType)) {
  fullSimple += seeds.length;
}

const smokeTypes = filterTypesForScope(c.typeDefinitions);
const smokeVals = filterValueCatalogForScope(c.simpleValuesByType);
let smokeSimple = 0;
for (const seeds of Object.values(smokeVals)) {
  smokeSimple += seeds.length;
}

console.log(
  JSON.stringify(
    {
      smokeTestEnabled: METADATA_SEED_SMOKE_TEST,
      full: {
        types: c.typeDefinitions.length,
        simpleValues: fullSimple,
        richValues: c.richValues.length,
        totalEntities: c.typeDefinitions.length + fullSimple + c.richValues.length,
        httpCallsAutoPublish: (c.typeDefinitions.length + fullSimple + c.richValues.length) * 2,
      },
      smoke: {
        types: smokeTypes.length,
        simpleValues: smokeSimple,
        richValues: 0,
        totalEntities: smokeTypes.length + smokeSimple,
        httpCallsAutoPublish: (smokeTypes.length + smokeSimple) * 2,
      },
    },
    null,
    2,
  ),
);
