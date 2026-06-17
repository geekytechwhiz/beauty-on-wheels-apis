/**
 * One-time backfill: set type-level `applicableModules` from Excel value rows.
 *
 * Does not create or update metadata values — only governed type UPDATE (draft → publish).
 * Run after `pnpm seed:metadata` completes; do not run concurrently with an active seed.
 *
 * Usage:
 *   pnpm backfill:metadata-type-modules
 *
 * Dry run: `$env:DRY_RUN="true"; pnpm backfill:metadata-type-modules`
 *
 * Single type: `$env:METADATA_TYPE_CODE="Country"; pnpm backfill:metadata-type-modules`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildTypeModuleBackfillPlan,
  modulesEqual,
  type TypeModuleBackfillPlan,
} from '../../helpers/catalog/type-modules-from-values';
import { loadMetadataCatalogFromExcel } from '../../helpers/excel/load-metadata-catalog';
import { logger } from '../../helpers/logger';
import {
  createMetadataApiClient,
  getMetadataType,
  loadRuntimeConfig,
  logSeedAuthContext,
  mapWithConcurrency,
  updateMetadataType,
} from '../../helpers/metadata-api';
import {
  buildMetadataTypePayload,
  validateTypePayload,
} from '../../helpers/payload-builder';

interface BackfillResult {
  metadataTypeCode: string;
  status: 'updated' | 'skipped' | 'failed';
  reason?: string;
  targetModules?: string[];
  error?: string;
  statusCode?: number;
}

interface BackfillSummary {
  planned: number;
  updated: number;
  skipped: number;
  failed: number;
  failedTypes: string[];
}

/** Loads a dotenv file; only sets keys not already in process.env. */
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

function parseOptionalTypeCodeFilter(): string | undefined {
  const raw = process.env.METADATA_TYPE_CODE?.trim();
  return raw || undefined;
}

function printSummary(summary: BackfillSummary, dryRun: boolean): void {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  console.log('\n========== Metadata Type Modules Backfill ==========');
  console.log(`${prefix}Planned types:  ${summary.planned}`);
  console.log(`${prefix}Updated:         ${summary.updated}`);
  console.log(`${prefix}Skipped:         ${summary.skipped}`);
  console.log(`${prefix}Failed:          ${summary.failed}`);
  if (summary.failedTypes.length) {
    console.log('\nFailed types:');
    for (const typeCode of summary.failedTypes) {
      console.log(`  - ${typeCode}`);
    }
  }
  console.log('====================================================\n');
}

async function backfillTypeModules(
  plan: TypeModuleBackfillPlan,
  client: ReturnType<typeof createMetadataApiClient>,
  config: ReturnType<typeof loadRuntimeConfig>,
): Promise<BackfillResult> {
  const { metadataTypeCode, targetModules, definition } = plan;

  const current = await getMetadataType(client, config, metadataTypeCode);
  if (!current) {
    logger.warn('Type not found in registry — skipping backfill', { metadataTypeCode });
    return {
      metadataTypeCode,
      status: 'skipped',
      reason: 'type not found',
      targetModules,
    };
  }

  if (modulesEqual(current.applicableModules, targetModules)) {
    logger.debug('Type modules already match — skipping', {
      metadataTypeCode,
      applicableModules: targetModules,
    });
    return {
      metadataTypeCode,
      status: 'skipped',
      reason: 'already up to date',
      targetModules,
    };
  }

  const payload = buildMetadataTypePayload(definition);
  const validationErrors = validateTypePayload(payload);
  if (validationErrors.length) {
    return {
      metadataTypeCode,
      status: 'failed',
      targetModules,
      error: validationErrors.join('; '),
    };
  }

  const outcome = await updateMetadataType(client, config, payload);
  if (!outcome.ok) {
    return {
      metadataTypeCode,
      status: 'failed',
      targetModules,
      error: outcome.error,
      statusCode: outcome.statusCode,
    };
  }

  logger.info('Type applicableModules backfilled', {
    metadataTypeCode,
    from: current.applicableModules ?? [],
    to: targetModules,
    version: outcome.data?.version,
    operation: outcome.data?.operation,
    duplicate: outcome.duplicate,
  });

  return {
    metadataTypeCode,
    status: 'updated',
    targetModules,
  };
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadRuntimeConfig();
  logSeedAuthContext(config);

  const catalog = loadMetadataCatalogFromExcel();
  const typeCodeFilter = parseOptionalTypeCodeFilter();
  let plans = buildTypeModuleBackfillPlan(catalog);
  if (typeCodeFilter) {
    plans = plans.filter((plan) => plan.metadataTypeCode === typeCodeFilter);
    if (!plans.length) {
      throw new Error(
        `No backfill plan for METADATA_TYPE_CODE=${typeCodeFilter} — check Excel catalog or type has no modules`,
      );
    }
  }

  logger.info('Starting metadata type modules backfill', {
    baseUrl: config.baseUrl,
    dryRun: config.dryRun,
    concurrency: config.concurrency,
    autoPublish: config.autoPublish,
    excelPath: catalog.excelPath,
    plannedTypes: plans.length,
    ...(typeCodeFilter ? { metadataTypeCode: typeCodeFilter } : {}),
    note: 'Metadata values are not modified by this script',
  });

  const client = createMetadataApiClient(config);
  const settled = await mapWithConcurrency(plans, config.concurrency, (plan) =>
    backfillTypeModules(plan, client, config),
  );

  const results: BackfillResult[] = [];
  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      results.push(entry.value);
      continue;
    }
    results.push({
      metadataTypeCode: 'unknown',
      status: 'failed',
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    });
  }

  const summary: BackfillSummary = {
    planned: plans.length,
    updated: results.filter((r) => r.status === 'updated').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    failedTypes: results.filter((r) => r.status === 'failed').map((r) => r.metadataTypeCode),
  };

  logger.info('Metadata type modules backfill complete', { ...summary });
  printSummary(summary, config.dryRun);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error('Metadata type modules backfill failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
