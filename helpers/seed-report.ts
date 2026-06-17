import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SeedCatalogScope } from './catalog/seed-catalog-scope';
import type { SeedResult, SeedRuntimeConfig, SeedSummary } from './interfaces';
import { logger } from './logger';

export type SeedReportItemStatus = 'success' | 'failed' | 'skipped';

export interface SeedReportItem {
  status: SeedReportItemStatus;
  error?: string;
  reason?: string;
  statusCode?: number;
  operation?: 'Add' | 'Update';
  version?: number;
  duplicate?: boolean;
}

export interface SeedReportValueFailure {
  metadataValueCode: string;
  error?: string;
  reason?: string;
  statusCode?: number;
}

export interface SeedReportTypeSection {
  metadataTypeCode: string;
  type: SeedReportItem | null;
  values: {
    success: string[];
    failed: SeedReportValueFailure[];
    skipped: SeedReportValueFailure[];
  };
  counts: {
    valuesSuccess: number;
    valuesFailed: number;
    valuesSkipped: number;
  };
}

export interface SeedReport {
  runAt: string;
  completedAt: string;
  durationMs: number;
  baseUrl: string;
  dryRun: boolean;
  seedMode: 'FULL' | 'SCOPED';
  selectedTypeCodes: string[];
  summary: SeedSummary & {
    typesSuccess: number;
    typesFailed: number;
    typesSkipped: number;
    valuesSuccess: number;
    valuesFailed: number;
    valuesSkipped: number;
  };
  byType: SeedReportTypeSection[];
  failures: Array<{
    name: string;
    entityKind: 'type' | 'value' | 'unknown';
    metadataTypeCode?: string;
    metadataValueCode?: string;
    status: SeedReportItemStatus;
    error?: string;
    reason?: string;
    statusCode?: number;
  }>;
}

export interface SeedReportPaths {
  jsonPath: string;
  csvPath: string;
}

function resultStatus(result: SeedResult): SeedReportItemStatus {
  if (result.skipped) {
    return 'skipped';
  }
  return result.success ? 'success' : 'failed';
}

function toReportItem(result: SeedResult): SeedReportItem {
  return {
    status: resultStatus(result),
    error: result.error,
    reason: result.reason,
    statusCode: result.statusCode,
    operation: result.operation,
    version: result.version,
    duplicate: result.duplicate,
  };
}

function parseResultName(name: string): {
  entityKind: 'type' | 'value' | 'unknown';
  metadataTypeCode?: string;
  metadataValueCode?: string;
} {
  if (name.startsWith('type:')) {
    return { entityKind: 'type', metadataTypeCode: name.slice('type:'.length) };
  }
  if (name.startsWith('value:')) {
    const rest = name.slice('value:'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) {
      return { entityKind: 'unknown' };
    }
    return {
      entityKind: 'value',
      metadataTypeCode: rest.slice(0, slash),
      metadataValueCode: rest.slice(slash + 1),
    };
  }
  return { entityKind: 'unknown' };
}

function ensureTypeSection(
  byType: Map<string, SeedReportTypeSection>,
  metadataTypeCode: string,
): SeedReportTypeSection {
  let section = byType.get(metadataTypeCode);
  if (!section) {
    section = {
      metadataTypeCode,
      type: null,
      values: { success: [], failed: [], skipped: [] },
      counts: { valuesSuccess: 0, valuesFailed: 0, valuesSkipped: 0 },
    };
    byType.set(metadataTypeCode, section);
  }
  return section;
}

export function buildSeedReport(input: {
  results: SeedResult[];
  summary: SeedSummary;
  scope: SeedCatalogScope;
  config: SeedRuntimeConfig;
  startedAt: Date;
  completedAt: Date;
}): SeedReport {
  const byType = new Map<string, SeedReportTypeSection>();

  for (const typeCode of input.scope.typeDependencyOrder) {
    ensureTypeSection(byType, typeCode);
  }

  let typesSuccess = 0;
  let typesFailed = 0;
  let typesSkipped = 0;
  let valuesSuccess = 0;
  let valuesFailed = 0;
  let valuesSkipped = 0;

  const failures: SeedReport['failures'] = [];

  for (const result of input.results) {
    const parsed = parseResultName(result.name);
    const status = resultStatus(result);

    if (status !== 'success') {
      failures.push({
        name: result.name,
        entityKind: parsed.entityKind,
        metadataTypeCode: parsed.metadataTypeCode,
        metadataValueCode: parsed.metadataValueCode,
        status,
        error: result.error,
        reason: result.reason,
        statusCode: result.statusCode,
      });
    }

    if (parsed.entityKind === 'type' && parsed.metadataTypeCode) {
      const section = ensureTypeSection(byType, parsed.metadataTypeCode);
      section.type = toReportItem(result);
      if (status === 'success') {
        typesSuccess += 1;
      } else if (status === 'skipped') {
        typesSkipped += 1;
      } else {
        typesFailed += 1;
      }
      continue;
    }

    if (parsed.entityKind === 'value' && parsed.metadataTypeCode && parsed.metadataValueCode) {
      const section = ensureTypeSection(byType, parsed.metadataTypeCode);
      if (status === 'success') {
        section.values.success.push(parsed.metadataValueCode);
        section.counts.valuesSuccess += 1;
        valuesSuccess += 1;
      } else if (status === 'skipped') {
        section.values.skipped.push({
          metadataValueCode: parsed.metadataValueCode,
          reason: result.reason ?? result.error ?? 'skipped',
          statusCode: result.statusCode,
        });
        section.counts.valuesSkipped += 1;
        valuesSkipped += 1;
      } else {
        section.values.failed.push({
          metadataValueCode: parsed.metadataValueCode,
          error: result.error ?? result.reason ?? 'failed',
          statusCode: result.statusCode,
        });
        section.counts.valuesFailed += 1;
        valuesFailed += 1;
      }
    }
  }

  return {
    runAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    baseUrl: input.config.baseUrl,
    dryRun: input.config.dryRun,
    seedMode: input.scope.mode,
    selectedTypeCodes: input.scope.selectedTypeCodes,
    summary: {
      ...input.summary,
      typesSuccess,
      typesFailed,
      typesSkipped,
      valuesSuccess,
      valuesFailed,
      valuesSkipped,
    },
    byType: [...byType.values()],
    failures,
  };
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function resolveSeedReportPaths(completedAt: Date): SeedReportPaths {
  const configured = process.env.SEED_REPORT_PATH?.trim();
  const defaultDir = path.join(__dirname, '..', 'scripts', 'metadata-registry-seed', 'reports');
  const stamp = timestampForFilename(completedAt);

  if (!configured) {
    const base = path.join(defaultDir, `seed-report-${stamp}`);
    return { jsonPath: `${base}.json`, csvPath: `${base}.csv` };
  }

  const resolved = path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);

  if (resolved.toLowerCase().endsWith('.json')) {
    return {
      jsonPath: resolved,
      csvPath: resolved.replace(/\.json$/i, '.csv'),
    };
  }
  if (resolved.toLowerCase().endsWith('.csv')) {
    return {
      jsonPath: resolved.replace(/\.csv$/i, '.json'),
      csvPath: resolved,
    };
  }

  const base = path.join(resolved, `seed-report-${stamp}`);
  return { jsonPath: `${base}.json`, csvPath: `${base}.csv` };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function seedReportToCsv(report: SeedReport): string {
  const header = [
    'entityKind',
    'metadataTypeCode',
    'metadataValueCode',
    'status',
    'operation',
    'version',
    'duplicate',
    'error',
    'reason',
    'statusCode',
  ];
  const rows: string[] = [header.join(',')];

  for (const section of report.byType) {
    if (section.type) {
      rows.push(
        [
          'type',
          section.metadataTypeCode,
          '',
          section.type.status,
          section.type.operation ?? '',
          section.type.version?.toString() ?? '',
          section.type.duplicate ? 'true' : '',
          section.type.error ?? '',
          section.type.reason ?? '',
          section.type.statusCode?.toString() ?? '',
        ]
          .map((cell) => csvEscape(String(cell)))
          .join(','),
      );
    }

    for (const valueCode of section.values.success) {
      rows.push(
        ['value', section.metadataTypeCode, valueCode, 'success', '', '', '', '', '', '']
          .map((cell) => csvEscape(cell))
          .join(','),
      );
    }
    for (const entry of section.values.failed) {
      rows.push(
        [
          'value',
          section.metadataTypeCode,
          entry.metadataValueCode,
          'failed',
          '',
          '',
          '',
          entry.error ?? '',
          '',
          entry.statusCode?.toString() ?? '',
        ]
          .map((cell) => csvEscape(String(cell)))
          .join(','),
      );
    }
    for (const entry of section.values.skipped) {
      rows.push(
        [
          'value',
          section.metadataTypeCode,
          entry.metadataValueCode,
          'skipped',
          '',
          '',
          '',
          '',
          entry.reason ?? '',
          entry.statusCode?.toString() ?? '',
        ]
          .map((cell) => csvEscape(String(cell)))
          .join(','),
      );
    }
  }

  return `${rows.join('\n')}\n`;
}

export function writeSeedReport(report: SeedReport, paths: SeedReportPaths): void {
  const writeCsv = process.env.SEED_REPORT_CSV !== 'false' && process.env.SEED_REPORT_CSV !== '0';

  fs.mkdirSync(path.dirname(paths.jsonPath), { recursive: true });
  fs.writeFileSync(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (writeCsv) {
    fs.mkdirSync(path.dirname(paths.csvPath), { recursive: true });
    fs.writeFileSync(paths.csvPath, seedReportToCsv(report), 'utf8');
  }

  logger.info('Metadata seed report written', {
    jsonPath: paths.jsonPath,
    ...(writeCsv ? { csvPath: paths.csvPath } : {}),
  });
}
