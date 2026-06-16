/**
 * Lightweight checks for scoped seed registry hydration (run: npx ts-node --project scripts/tsconfig.json scripts/seed-registry-hydration.check.ts)
 */
import { resetMetadataCatalogCache } from '../helpers/excel/load-metadata-catalog';
import {
  buildFullCatalogValueTypeIndex,
  collectDependencyRequirements,
} from '../helpers/catalog/seed-registry-hydration';
import { resolveSeedCatalogScope } from '../helpers/catalog/seed-catalog-scope';
import { loadMetadataCatalogFromExcel } from '../helpers/excel/load-metadata-catalog';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  resetMetadataCatalogCache();
  const catalog = loadMetadataCatalogFromExcel();
  const index = buildFullCatalogValueTypeIndex(catalog);

  let sampleType: string | undefined;
  for (const typeCode of catalog.typeOrder) {
    const seeds = [
      ...(catalog.simpleValuesByType[typeCode] ?? []),
      ...catalog.richValues.filter(
        (seed) => catalog.richValueTypeByCode[seed.metadataValueCode] === typeCode,
      ),
    ];
    if (
      seeds.some((seed) =>
        seed.applicableModules?.some((module) => module.trim().toUpperCase() === 'TEMPLATE'),
      )
    ) {
      sampleType = typeCode;
      break;
    }
  }
  assert(Boolean(sampleType), 'expected at least one Excel type with ApplicableModule TEMPLATE');

  process.env.METADATA_TYPE_CODES = sampleType!;
  resetMetadataCatalogCache();
  const scope = resolveSeedCatalogScope();
  assert(scope.mode === 'SCOPED', 'expected SCOPED mode');

  const requirements = collectDependencyRequirements(scope, index);
  const modules = requirements.get('ApplicableModule');
  assert(Boolean(modules?.has('TEMPLATE')), `${sampleType} should require ApplicableModule TEMPLATE`);
  assert(!requirements.has(sampleType!), 'scoped type itself should not be a dependency requirement');

  delete process.env.METADATA_TYPE_CODES;
  resetMetadataCatalogCache();

  console.log('seed-registry-hydration.check.ts: all assertions passed');
}

run();
