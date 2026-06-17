/**
 * Seeds Metadata Registry governed catalog via HTTP (draft ΓåÆ publish workflow).
 *
 * Local runbook (from repo root):
 *   1. Start registry: `pnpm metadata-registry-service:offline`
 *      (manual: `cd apps/metadata-registry-service && npx serverless offline --stage dev`)
 *   2. Seed: `pnpm seed:metadata`
 *      Dry run (PowerShell): `$env:DRY_RUN="true"; pnpm seed:metadata`
 *      Dry run (bash):       `DRY_RUN=true pnpm seed:metadata`
 *
 * BASE_URL must include the serverless stage (default `http://localhost:3000/dev`).
 *
 * Usage:
 *   pnpm seed:metadata
 *
 * Requires BASE_URL (see scripts/metadata-registry-seed/.env.example). AUTH_TOKEN is optional for local offline.
 * Phase 1 creates types with `applicableModules` aggregated from Excel value rows (and overrides).
 * Re-seed with TREAT_CONFLICT_AS_SUCCESS=true skips existing entities.
 *
 * Scoped seed (selected types + their values only):
 *   $env:METADATA_TYPE_CODES="Department,Specialty"; pnpm seed:metadata
 *   Prerequisite values (e.g. ApplicableModule TEMPLATE) are hydrated from the API before Phase 2.
 *
 * After each run, JSON + CSV reports are written under scripts/metadata-registry-seed/reports/
 * (override with SEED_REPORT_PATH; disable CSV with SEED_REPORT_CSV=false).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  isSmokeTestEnabled,
  METADATA_SEED_PREREQUISITE_TYPES,
  METADATA_SEED_SMOKE_TYPES,
} from '../../helpers/catalog/seed-scope';
import {
  countSeedValues,
  logSeedCatalogScope,
  resolveSeedCatalogScope,
  type SeedCatalogScope,
} from '../../helpers/catalog/seed-catalog-scope';
import { hydrateRegistryForScopedSeed } from '../../helpers/catalog/seed-registry-hydration';
import type {
  MetadataTypeCreatePayload,
  MetadataTypeSeedDefinition,
  MetadataValueCreatePayload,
  RegistrySnapshot,
  RichValueSeed,
  SeedResult,
  SeedSummary,
  SimpleValueSeed,
} from '../../helpers/interfaces';
import { logger } from '../../helpers/logger';
import {
  createMetadataApiClient,
  createMetadataType,
  createMetadataValue,
  loadRuntimeConfig,
  logSeedAuthContext,
  mapWithConcurrency,
} from '../../helpers/metadata-api';
import {
  buildMetadataTypePayload,
  buildMetadataValuePayload,
  validateTypePayload,
  validateValuePayload,
} from '../../helpers/payload-builder';
import {
  registerType,
  registerValue,
  shouldSkipDueToDependencies,
} from '../../helpers/validation';
import {
  buildSeedReport,
  resolveSeedReportPaths,
  writeSeedReport,
} from '../../helpers/seed-report';

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

/**
 * Loads `scripts/metadata-registry-seed/.env`, then `.env.example` for any unset keys.
 * BASE_URL still defaults in loadRuntimeConfig when neither file defines it.
 */
function loadDotEnv(): void {
  const dir = __dirname;
  const loadedEnv = loadEnvFile(path.join(dir, '.env'));
  const loadedExample = loadEnvFile(path.join(dir, '.env.example'));
  if (!loadedEnv && !loadedExample) {
    logger.debug('No scripts/metadata-registry-seed/.env or .env.example found — using defaults');
  }
}

function orderedTypeDefinitions(scope: SeedCatalogScope): MetadataTypeSeedDefinition[] {
  const byCode = new Map(scope.typeDefinitions.map((d) => [d.metadataTypeCode, d]));
  const ordered: MetadataTypeSeedDefinition[] = [];
  for (const code of scope.typeDependencyOrder) {
    const def = byCode.get(code);
    if (def) {
      ordered.push(def);
    } else {
      logger.warn('No type definition found for dependency order entry', { code });
    }
  }
  return ordered;
}

function collectSimpleValueSeedsForType(
  scope: SeedCatalogScope,
  metadataTypeCode: string,
): SimpleValueSeed[] {
  return scope.simpleValuesByType[metadataTypeCode] ?? [];
}

function collectRichValueSeedsForType(
  scope: SeedCatalogScope,
  metadataTypeCode: string,
): RichValueSeed[] {
  return scope.richValues.filter(
    (v) => scope.richValueTypeByCode[v.metadataValueCode] === metadataTypeCode,
  );
}

async function seedTypes(
  config: ReturnType<typeof loadRuntimeConfig>,
  registry: RegistrySnapshot,
  results: SeedResult[],
  scope: SeedCatalogScope,
): Promise<void> {
  const client = createMetadataApiClient(config);
  const definitions = orderedTypeDefinitions(scope);

  logger.info('Phase 1: drafting and publishing metadata types', { count: definitions.length });

  for (const def of definitions) {
    const name = `type:${def.metadataTypeCode}`;
    const payload = buildMetadataTypePayload(def);
    const validationErrors = validateTypePayload(payload);
    if (validationErrors.length) {
      logger.error('Type payload validation failed', { name, validationErrors });
      results.push({
        name,
        success: false,
        reason: validationErrors.join('; '),
        payload,
      });
      continue;
    }

    const outcome = await createMetadataType(client, config, payload);
    if (outcome.ok) {
      registerType(registry, def.metadataTypeCode);
      results.push({
        name,
        success: true,
        payload,
        operation: outcome.data?.operation,
        version: outcome.data?.version,
        duplicate: outcome.duplicate,
      });
      logger.info('Metadata type published', {
        metadataTypeCode: def.metadataTypeCode,
        duplicate: outcome.duplicate,
        version: outcome.data?.version,
        operation: outcome.data?.operation,
      });
    } else {
      results.push({
        name,
        success: false,
        payload,
        error: outcome.error,
        statusCode: outcome.statusCode,
      });
      logger.error('Metadata type draft/publish failed', {
        metadataTypeCode: def.metadataTypeCode,
        error: outcome.error,
      });
    }
  }
}

async function seedValuesForType(
  config: ReturnType<typeof loadRuntimeConfig>,
  registry: RegistrySnapshot,
  results: SeedResult[],
  metadataTypeCode: string,
  seeds: (SimpleValueSeed | RichValueSeed)[],
  concurrencyOverride?: number,
): Promise<void> {
  const client = createMetadataApiClient(config);
  const concurrency = concurrencyOverride ?? config.concurrency;

  const tasks = seeds.map((seed) => async (): Promise<SeedResult> => {
    const name = `value:${metadataTypeCode}/${seed.metadataValueCode}`;
    const payload = buildMetadataValuePayload(metadataTypeCode, seed);

    const validationErrors = validateValuePayload(payload);
    if (validationErrors.length) {
      logger.error('Value payload validation failed', { name, validationErrors });
      return {
        name,
        success: false,
        reason: validationErrors.join('; '),
        payload,
      };
    }

    if (shouldSkipDueToDependencies(name, payload, registry)) {
      return {
        name,
        success: false,
        skipped: true,
        reason: 'Missing dependency',
        payload,
      };
    }

    const outcome = await createMetadataValue(client, config, payload);
    if (outcome.ok) {
      registerValue(registry, metadataTypeCode, seed.metadataValueCode);
      logger.info('Metadata value published', {
        metadataTypeCode,
        metadataValueCode: seed.metadataValueCode,
        duplicate: outcome.duplicate,
        version: outcome.data?.version,
        operation: outcome.data?.operation,
      });
      return {
        name,
        success: true,
        payload,
        operation: outcome.data?.operation,
        version: outcome.data?.version,
        duplicate: outcome.duplicate,
      };
    }

    logger.error('Metadata value draft/publish failed', {
      metadataTypeCode,
      metadataValueCode: seed.metadataValueCode,
      error: outcome.error,
    });
    return {
      name,
      success: false,
      payload,
      error: outcome.error,
      statusCode: outcome.statusCode,
    };
  });

  const settled = await mapWithConcurrency(tasks, concurrency, (task) => task());
  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      results.push(entry.value);
    } else {
      results.push({
        name: 'unknown',
        success: false,
        error: String(entry.reason),
      });
    }
  }
}

async function seedRichValues(
  config: ReturnType<typeof loadRuntimeConfig>,
  registry: RegistrySnapshot,
  results: SeedResult[],
  scope: SeedCatalogScope,
): Promise<void> {
  logger.info('Phase 3: drafting and publishing values with relations / attributes');

  for (const metadataTypeCode of scope.typeDependencyOrder) {
    const seeds = collectRichValueSeedsForType(scope, metadataTypeCode);
    if (!seeds.length) {
      continue;
    }

    if (!registry.typesCreated.has(metadataTypeCode)) {
      logger.warn('Skipping rich values ΓÇö parent type not created', { metadataTypeCode });
      for (const seed of seeds) {
        results.push({
          name: `value:${metadataTypeCode}/${seed.metadataValueCode}`,
          success: false,
          skipped: true,
          reason: 'Parent type missing',
        });
      }
      continue;
    }

    logger.info('Seeding rich values for type', {
      metadataTypeCode,
      count: seeds.length,
      concurrency: config.concurrency,
    });
    await seedValuesForType(config, registry, results, metadataTypeCode, seeds);
  }
}

async function seedValues(
  config: ReturnType<typeof loadRuntimeConfig>,
  registry: RegistrySnapshot,
  results: SeedResult[],
  scope: SeedCatalogScope,
): Promise<void> {
  logger.info('Phase 2: drafting and publishing metadata values');

  for (const metadataTypeCode of scope.typeDependencyOrder) {
    const seeds = collectSimpleValueSeedsForType(scope, metadataTypeCode);
    if (!seeds.length) {
      logger.debug('No values defined for type', { metadataTypeCode });
      continue;
    }

    if (!registry.typesCreated.has(metadataTypeCode)) {
      logger.warn('Skipping all values ΓÇö parent type not created', { metadataTypeCode });
      for (const seed of seeds) {
        results.push({
          name: `value:${metadataTypeCode}/${seed.metadataValueCode}`,
          success: false,
          skipped: true,
          reason: 'Parent type missing',
        });
      }
      continue;
    }

    logger.info('Seeding values for type', {
      metadataTypeCode,
      count: seeds.length,
    });
    await seedValuesForType(config, registry, results, metadataTypeCode, seeds);
  }
}

function summarize(results: SeedResult[]): SeedSummary {
  const failed = results.filter((r) => !r.success && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const success = results.filter((r) => r.success);

  return {
    successCount: success.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    failedNames: failed.map((r) => r.name),
    failedPayloads: failed
      .filter(
        (r): r is SeedResult & { payload: MetadataTypeCreatePayload | MetadataValueCreatePayload } =>
          Boolean(r.payload),
      )
      .map((r) => ({
        name: r.name,
        payload: r.payload,
        error: r.error ?? r.reason ?? 'unknown',
      })),
  };
}

function printSummary(summary: SeedSummary, dryRun: boolean, reportPaths?: { jsonPath: string; csvPath: string }): void {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  logger.info(`${prefix}Seed complete`, {
    successCount: summary.successCount,
    failedCount: summary.failedCount,
    skippedCount: summary.skippedCount,
  });

  console.log('\n========== Metadata Seed Summary ==========');
  console.log(`${prefix}Success count: ${summary.successCount}`);
  console.log(`${prefix}Failed count:  ${summary.failedCount}`);
  if (summary.skippedCount > 0) {
    console.log(`Skipped count:   ${summary.skippedCount}`);
  }
  if (summary.failedNames.length) {
    console.log('\nFailed metadata names:');
    for (const name of summary.failedNames) {
      console.log(`  - ${name}`);
    }
  }
  if (summary.failedPayloads.length) {
    console.log('\nFailed payloads:');
    for (const fp of summary.failedPayloads) {
      console.log(`\n--- ${fp.name} ---`);
      console.log(`Error: ${fp.error}`);
      console.log(JSON.stringify(fp.payload, null, 2));
    }
  }
  if (reportPaths) {
    console.log(`\nReport (JSON): ${reportPaths.jsonPath}`);
    console.log(`Report (CSV):  ${reportPaths.csvPath}`);
  }
  console.log('===========================================\n');
}

async function main(): Promise<void> {
  loadDotEnv();
  const startedAt = new Date();
  const config = loadRuntimeConfig();
  logSeedAuthContext(config);
  const registry: RegistrySnapshot = {
    valuesByType: new Map(),
    typesCreated: new Set(),
  };
  const results: SeedResult[] = [];
  const scope = resolveSeedCatalogScope();
  logSeedCatalogScope(scope);

  logger.info('Starting metadata registry seed', {
    baseUrl: config.baseUrl,
    dryRun: config.dryRun,
    concurrency: config.concurrency,
    autoPublish: config.autoPublish,
    typePath: config.typePath,
    valuePath: config.valuePath,
    seedMode: scope.mode,
    ...(scope.mode === 'SCOPED'
      ? {
          selectedTypeCodes: scope.selectedTypeCodes,
          filteredTypeCount: scope.typeDependencyOrder.length,
          filteredValueCount: countSeedValues(scope),
        }
      : {}),
    smokeTest: isSmokeTestEnabled(),
    ...(isSmokeTestEnabled()
      ? {
          smokeTypes: [...METADATA_SEED_SMOKE_TYPES],
          prerequisiteTypes: [...METADATA_SEED_PREREQUISITE_TYPES],
        }
      : {}),
  });

  const client = createMetadataApiClient(config);
  await seedTypes(config, registry, results, scope);
  if (scope.mode === 'SCOPED') {
    await hydrateRegistryForScopedSeed(client, config, registry, scope);
  }
  await seedValues(config, registry, results, scope);
  await seedRichValues(config, registry, results, scope);

  const summary = summarize(results);
  const completedAt = new Date();
  const report = buildSeedReport({
    results,
    summary,
    scope,
    config,
    startedAt,
    completedAt,
  });
  const reportPaths = resolveSeedReportPaths(completedAt);
  writeSeedReport(report, reportPaths);
  printSummary(summary, config.dryRun, reportPaths);

  if (summary.failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  logger.error('Seed script failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
