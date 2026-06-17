/**
 * Targeted metadata type seed — creates types only (no values).
 *
 * Use when new type-only rows were added to Excel and a full seed is not needed.
 *
 * Usage:
 *   $env:METADATA_TYPE_CODES="Department,TemplateName"
 *   pnpm seed:metadata-types
 *
 * Skips types that already exist in the registry (GET). Values are never created.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadMetadataCatalogFromExcel } from '../../helpers/excel/load-metadata-catalog';
import type { MetadataTypeSeedDefinition } from '../../helpers/interfaces';
import { logger } from '../../helpers/logger';
import {
  createMetadataApiClient,
  createMetadataType,
  getMetadataType,
  loadRuntimeConfig,
  logSeedAuthContext,
} from '../../helpers/metadata-api';
import {
  buildMetadataTypePayload,
  validateTypePayload,
} from '../../helpers/payload-builder';

interface TypeSeedResult {
  metadataTypeCode: string;
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
  error?: string;
  statusCode?: number;
}

interface TypeSeedSummary {
  planned: number;
  created: number;
  skipped: number;
  failed: number;
  failedTypes: string[];
}

function loadEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

function loadDotEnv(): void {
  const dir = __dirname;
  loadEnvFile(path.join(dir, '.env'));
  loadEnvFile(path.join(dir, '.env.example'));
}

function parseTypeCodeFilter(): Set<string> {
  const raw = process.env.METADATA_TYPE_CODES?.trim();
  if (!raw) {
    throw new Error(
      'METADATA_TYPE_CODES is required — comma-separated list, e.g. Department,TemplateName',
    );
  }
  const codes = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (!codes.length) {
    throw new Error('METADATA_TYPE_CODES is empty after parsing');
  }
  return new Set(codes);
}

function selectTypeDefinitions(
  catalog: ReturnType<typeof loadMetadataCatalogFromExcel>,
  filter: Set<string>,
): MetadataTypeSeedDefinition[] {
  const ordered = catalog.typeDefinitions.filter((def) => filter.has(def.metadataTypeCode));
  const found = new Set(ordered.map((def) => def.metadataTypeCode));
  const missing = [...filter].filter((code) => !found.has(code));
  if (missing.length) {
    logger.warn('Type codes not found in Excel catalog — skipping', { missing });
  }
  return ordered;
}

function printSummary(summary: TypeSeedSummary, dryRun: boolean): void {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  console.log('\n========== Metadata Type Seed (types only) ==========');
  console.log(`${prefix}Planned types: ${summary.planned}`);
  console.log(`${prefix}Created:        ${summary.created}`);
  console.log(`${prefix}Skipped:        ${summary.skipped}`);
  console.log(`${prefix}Failed:         ${summary.failed}`);
  if (summary.failedTypes.length) {
    console.log('\nFailed types:');
    for (const typeCode of summary.failedTypes) {
      console.log(`  - ${typeCode}`);
    }
  }
  console.log('=====================================================\n');
}

async function seedType(
  def: MetadataTypeSeedDefinition,
  client: ReturnType<typeof createMetadataApiClient>,
  config: ReturnType<typeof loadRuntimeConfig>,
): Promise<TypeSeedResult> {
  const { metadataTypeCode } = def;

  const existing = await getMetadataType(client, config, metadataTypeCode);
  if (existing) {
    logger.info('Type already exists — skipping', { metadataTypeCode });
    return { metadataTypeCode, status: 'skipped', reason: 'already exists' };
  }

  const payload = buildMetadataTypePayload(def);
  const validationErrors = validateTypePayload(payload);
  if (validationErrors.length) {
    return {
      metadataTypeCode,
      status: 'failed',
      error: validationErrors.join('; '),
    };
  }

  const outcome = await createMetadataType(client, config, payload);
  if (!outcome.ok) {
    return {
      metadataTypeCode,
      status: 'failed',
      error: outcome.error,
      statusCode: outcome.statusCode,
    };
  }

  logger.info('Metadata type created', {
    metadataTypeCode,
    version: outcome.data?.version,
    operation: outcome.data?.operation,
    duplicate: outcome.duplicate,
  });
  return { metadataTypeCode, status: 'created' };
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadRuntimeConfig();
  logSeedAuthContext(config);

  const filter = parseTypeCodeFilter();
  const catalog = loadMetadataCatalogFromExcel();
  const definitions = selectTypeDefinitions(catalog, filter);

  logger.info('Starting targeted metadata type seed', {
    baseUrl: config.baseUrl,
    dryRun: config.dryRun,
    excelPath: catalog.excelPath,
    plannedTypes: definitions.length,
    typeCodes: definitions.map((def) => def.metadataTypeCode),
    note: 'Metadata values are not created by this script',
  });

  const client = createMetadataApiClient(config);
  const results: TypeSeedResult[] = [];

  for (const def of definitions) {
    results.push(await seedType(def, client, config));
  }

  const summary: TypeSeedSummary = {
    planned: definitions.length,
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    failedTypes: results.filter((r) => r.status === 'failed').map((r) => r.metadataTypeCode),
  };

  logger.info('Targeted metadata type seed complete', { ...summary });
  printSummary(summary, config.dryRun);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error('Targeted metadata type seed failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
