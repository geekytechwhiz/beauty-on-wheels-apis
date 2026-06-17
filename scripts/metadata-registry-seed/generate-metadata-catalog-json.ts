/**
 * Generates helpers/metadata/catalog.generated.json from the Excel source of truth.
 *
 * Usage: pnpm generate:metadata-catalog
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  catalogToJson,
  loadMetadataCatalogFromExcel,
  resolveMetadataExcelPath,
} from '../../helpers/excel/load-metadata-catalog';
import { logger } from '../../helpers/logger';

function main(): void {
  const excelPath = resolveMetadataExcelPath();
  logger.info('Loading metadata catalog from Excel', { excelPath });

  const catalog = loadMetadataCatalogFromExcel();
  const outPath = path.join(__dirname, '..', '..', 'helpers', 'metadata', 'catalog.generated.json');
  fs.writeFileSync(outPath, catalogToJson(catalog), 'utf8');

  const typeCount = catalog.typeDefinitions.length;
  const valueCount = Object.values(catalog.simpleValuesByType).reduce((sum, rows) => sum + rows.length, 0);

  logger.info('Wrote generated catalog JSON', {
    outPath,
    typeCount,
    simpleValueCount: valueCount,
    richValueCount: catalog.richValues.length,
  });

  console.log(`Generated ${outPath}`);
  console.log(`Types: ${typeCount}, simple values: ${valueCount}, rich values: ${catalog.richValues.length}`);
}

main();
