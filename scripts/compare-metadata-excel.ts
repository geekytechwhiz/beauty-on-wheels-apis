/**
 * Compare two metadata Excel catalogs — lists new types and values in the newer file.
 *
 * Usage:
 *   npx ts-node --project scripts/tsconfig.json scripts/compare-metadata-excel.ts
 *   npx ts-node --project scripts/tsconfig.json scripts/compare-metadata-excel.ts "path/old.xlsx" "path/new.xlsx"
 */
import * as path from 'node:path';

import { loadMetadataCatalogFromExcel } from '../helpers/excel/load-metadata-catalog';
import type { LoadedMetadataCatalog } from '../helpers/excel/load-metadata-catalog';

function valueKeys(catalog: LoadedMetadataCatalog): Set<string> {
  const keys = new Set<string>();
  for (const [typeCode, seeds] of Object.entries(catalog.simpleValuesByType)) {
    for (const seed of seeds) {
      keys.add(`${typeCode}/${seed.metadataValueCode}`);
    }
  }
  for (const seed of catalog.richValues) {
    const typeCode = catalog.richValueTypeByCode[seed.metadataValueCode];
    if (typeCode) {
      keys.add(`${typeCode}/${seed.metadataValueCode}`);
    }
  }
  return keys;
}

function main(): void {
  const metadataDir = path.join(__dirname, '..', 'helpers', 'metadata');
  const oldPath = process.argv[2] ?? path.join(metadataDir, 'Complete metadata (1).xlsx');
  const newPath = process.argv[3] ?? path.join(metadataDir, 'Complete metadata (2).xlsx');

  const oldCatalog = loadMetadataCatalogFromExcel(oldPath);
  const newCatalog = loadMetadataCatalogFromExcel(newPath);

  const oldTypes = new Set(oldCatalog.typeOrder);
  const addedTypes = newCatalog.typeOrder.filter((code) => !oldTypes.has(code));
  const removedTypes = oldCatalog.typeOrder.filter((code) => !newCatalog.typeOrder.includes(code));

  const oldVals = valueKeys(oldCatalog);
  const newVals = valueKeys(newCatalog);
  const addedValues = [...newVals].filter((key) => !oldVals.has(key)).sort();

  const typesWithNewValuesOnly = [
    ...new Set(addedValues.map((key) => key.split('/')[0] ?? '')),
  ]
    .filter((code) => code && !addedTypes.includes(code))
    .sort();

  const typesToSeed = [...new Set([...addedTypes, ...typesWithNewValuesOnly])].sort();

  console.log('========== Metadata Excel Comparison ==========');
  console.log(`Old: ${oldPath}`);
  console.log(`New: ${newPath}`);
  console.log('');
  console.log(`Old catalog: ${oldCatalog.typeOrder.length} types, ${oldVals.size} values`);
  console.log(`New catalog: ${newCatalog.typeOrder.length} types, ${newVals.size} values`);
  console.log('');

  if (removedTypes.length) {
    console.log(`Removed types (${removedTypes.length}): ${removedTypes.join(', ')}`);
    console.log('');
  }

  console.log(`New types (${addedTypes.length}):`);
  if (!addedTypes.length) {
    console.log('  (none)');
  } else {
    for (const code of addedTypes) {
      const simple = newCatalog.simpleValuesByType[code]?.length ?? 0;
      const rich = newCatalog.richValues.filter(
        (v) => newCatalog.richValueTypeByCode[v.metadataValueCode] === code,
      ).length;
      console.log(`  - ${code} (simple: ${simple}, rich: ${rich})`);
    }
  }
  console.log('');

  console.log(`New values: ${addedValues.length}`);
  if (typesWithNewValuesOnly.length) {
    console.log(
      `Existing types with new values (${typesWithNewValuesOnly.length}): ${typesWithNewValuesOnly.join(', ')}`,
    );
  }
  console.log('');

  console.log('--- Run scoped seed for all changes ---');
  console.log(`METADATA_TYPE_CODES="${typesToSeed.join(',')}"`);
  console.log('===========================================\n');

  if (addedValues.length > 0 && addedValues.length <= 40) {
    console.log('Added value keys:');
    for (const key of addedValues) {
      console.log(`  ${key}`);
    }
  } else if (addedValues.length > 40) {
    console.log('Added value keys (first 40):');
    for (const key of addedValues.slice(0, 40)) {
      console.log(`  ${key}`);
    }
    console.log(`  ... and ${addedValues.length - 40} more`);
  }
}

main();
