/**
 * Lightweight checks for seed catalog scoping (run: npx ts-node --project scripts/tsconfig.json scripts/seed-catalog-scope.check.ts)
 */
import { resetMetadataCatalogCache } from '../../helpers/excel/load-metadata-catalog';
import {
  countSeedValues,
  resolveSeedCatalogScope,
} from '../../helpers/catalog/seed-catalog-scope';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  delete process.env.METADATA_TYPE_CODES;
  resetMetadataCatalogCache();
  const full = resolveSeedCatalogScope();
  assert(full.mode === 'FULL', 'expected FULL mode');
  assert(full.typeDependencyOrder.length > 0, 'full seed should include types');

  process.env.METADATA_TYPE_CODES = 'Department';
  resetMetadataCatalogCache();
  const one = resolveSeedCatalogScope();
  assert(one.mode === 'SCOPED', 'expected SCOPED mode');
  assert(one.typeDependencyOrder.length === 1, 'Department scope should have 1 type');
  assert(one.typeDependencyOrder[0] === 'Department', 'expected Department type');
  assert(countSeedValues(one) === 0, 'Department has no values in Excel');

  process.env.METADATA_TYPE_CODES = 'Department,Specialty';
  resetMetadataCatalogCache();
  const two = resolveSeedCatalogScope();
  assert(two.selectedTypeCodes.join(',') === 'Department,Specialty', 'preserve env order in log');
  assert(two.typeDependencyOrder.length === 2, 'expected 2 filtered types');
  assert(countSeedValues(two) > 0, 'Specialty should contribute values');

  console.log('seed-catalog-scope.check.ts: all assertions passed');
}

run();
