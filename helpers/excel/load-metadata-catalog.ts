import * as fs from 'node:fs';
import * as path from 'node:path';

import * as XLSX from 'xlsx';

import {
  defaultMetadataTypeDefinition,
  humanizeMetadataTypeCode,
  resolveMetadataTypeDefinition,
} from '../catalog/type-overrides';
import type {
  MetadataTypeSeedDefinition,
  RichValueSeed,
  SimpleValueSeed,
} from '../interfaces';

const DEFAULT_EXCEL_FILE = 'Complete metadata.xlsx';
const MAIN_SHEET = 'Completed Metadata';
const STATE_SHEET = 'State Values';
const CITY_SHEET = 'City';

const PLACEHOLDER_VALUES = new Set([
  'PLATFORM_SUPPORTED_STATES',
  'PLATFORM_SUPPORTED_CITIES',
]);

/** Condition → Category (not in Excel; required by Condition type relation config). */
const CONDITION_CATEGORY_RELATIONS: Record<string, string> = {
  HYPERTENSION: 'CHRONIC_DISEASE',
  DIABETES: 'CHRONIC_DISEASE',
  ANNUAL_WELLNESS: 'WELLNESS',
};

const METRIC_VALUE_ATTRIBUTES: Record<string, Record<string, unknown>> = {
  BP_SYSTOLIC: {
    dataType: 'Numeric',
    unit: 'mmHg',
    supportedSourceTypes: ['Device', 'Manual', 'HMS'],
    supportedEvaluationLogic: ['LatestValue', 'Average', 'ThresholdBased'],
    directionality: 'Neutral',
    decimalAllowed: false,
  },
  BP_DIASTOLIC: {
    dataType: 'Numeric',
    unit: 'mmHg',
    supportedSourceTypes: ['Device', 'Manual', 'HMS'],
    supportedEvaluationLogic: ['LatestValue', 'Average', 'ThresholdBased'],
    directionality: 'Neutral',
    decimalAllowed: false,
  },
  HEART_RATE: {
    dataType: 'Numeric',
    unit: 'bpm',
    supportedSourceTypes: ['Device', 'Manual', 'HMS'],
    supportedEvaluationLogic: ['LatestValue', 'Average'],
    directionality: 'Neutral',
    decimalAllowed: false,
  },
  SPO2: {
    dataType: 'Numeric',
    unit: '%',
    supportedSourceTypes: ['Device', 'Manual', 'HMS'],
    supportedEvaluationLogic: ['LatestValue', 'Average'],
    directionality: 'HigherIsBetter',
    decimalAllowed: false,
  },
  GLUCOSE: {
    dataType: 'Numeric',
    unit: 'mg/dL',
    supportedSourceTypes: ['Device', 'Manual', 'HMS'],
    supportedEvaluationLogic: ['LatestValue', 'Average', 'ThresholdBased'],
    directionality: 'Neutral',
    decimalAllowed: true,
  },
  WEIGHT: {
    dataType: 'Numeric',
    unit: 'kg',
    supportedSourceTypes: ['Device', 'Manual', 'HMS'],
    supportedEvaluationLogic: ['LatestValue', 'Average'],
    directionality: 'Neutral',
    decimalAllowed: true,
  },
};

export interface LoadedMetadataCatalog {
  excelPath: string;
  typeOrder: string[];
  typeDefinitions: MetadataTypeSeedDefinition[];
  simpleValuesByType: Record<string, SimpleValueSeed[]>;
  richValues: RichValueSeed[];
  richValueTypeByCode: Record<string, string>;
}

type RawRow = Record<string, unknown>;

let cachedCatalog: LoadedMetadataCatalog | null = null;

export function resolveMetadataExcelPath(): string {
  const configured = process.env.METADATA_EXCEL_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.join(__dirname, '..', 'metadata', DEFAULT_EXCEL_FILE);
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '');
}

const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  metadatatype: 'metadataTypeCode',
  metadatavalue: 'metadataValueCode',
  label: 'label',
  applicablemodules: 'applicableModules',
  applicablecategories: 'applicableCategories',
  applicableconditions: 'applicableConditions',
  applicablecountries: 'applicableCountries',
  applicablelanguages: 'applicableLanguages',
  originalstatecode: 'originalStateCode',
  countrylabel: 'countryLabel',
};

interface ParsedRow {
  metadataTypeCode: string;
  metadataValueCode: string;
  label: string;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
  originalStateCode?: string;
  countryLabel?: string;
}

function parseList(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const text = String(raw).trim();
  if (!text) {
    return undefined;
  }
  const tokens = text
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  return tokens.length ? tokens : undefined;
}

function parseRow(raw: RawRow): ParsedRow | null {
  const mapped: Partial<ParsedRow> = {};
  for (const [header, value] of Object.entries(raw)) {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (!key) {
      continue;
    }
    if (
      key === 'applicableModules' ||
      key === 'applicableCategories' ||
      key === 'applicableConditions' ||
      key === 'applicableCountries' ||
      key === 'applicableLanguages'
    ) {
      mapped[key] = parseList(value);
    } else {
      const text = String(value ?? '').trim();
      if (text) {
        mapped[key] = text as never;
      }
    }
  }

  if (!mapped.metadataValueCode || !mapped.label) {
    return null;
  }
  return mapped as ParsedRow;
}

function readSheetRows(workbook: XLSX.WorkBook, sheetName: string): RawRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '' });
}

function toSimpleValueSeed(row: ParsedRow, sortOrder: number): SimpleValueSeed {
  const hasApplicability = Boolean(
    row.applicableModules?.length ||
      row.applicableCategories?.length ||
      row.applicableConditions?.length ||
      row.applicableCountries?.length ||
      row.applicableLanguages?.length,
  );

  const seed: SimpleValueSeed = {
    metadataValueCode: row.metadataValueCode.trim().toUpperCase(),
    label: row.label.trim(),
    sortOrder,
    isGlobal: row.metadataTypeCode === 'ApplicableModule' ? true : !hasApplicability,
  };

  if (row.applicableModules?.length) {
    seed.applicableModules = row.applicableModules;
  }
  if (row.applicableCategories?.length) {
    seed.applicableCategories = row.applicableCategories;
  }
  if (row.applicableConditions?.length) {
    seed.applicableConditions = row.applicableConditions;
  }
  if (row.applicableCountries?.length) {
    seed.applicableCountries = row.applicableCountries;
  }
  if (row.applicableLanguages?.length) {
    seed.applicableLanguages = row.applicableLanguages;
  }

  return seed;
}

function ingestSheetRows(
  rows: RawRow[],
  valuesByType: Map<string, SimpleValueSeed[]>,
  typeOrder: string[],
  options?: { skipPlaceholders?: boolean },
): void {
  let currentType = '';

  for (const raw of rows) {
    const parsed = parseRow(raw);
    if (!parsed) {
      continue;
    }

    if (parsed.metadataTypeCode) {
      currentType = parsed.metadataTypeCode.trim();
      if (!typeOrder.includes(currentType)) {
        typeOrder.push(currentType);
      }
    }

    if (!currentType) {
      continue;
    }

    parsed.metadataTypeCode = currentType;

    if (options?.skipPlaceholders && PLACEHOLDER_VALUES.has(parsed.metadataValueCode.toUpperCase())) {
      continue;
    }

    const bucket = valuesByType.get(currentType) ?? [];
    bucket.push(toSimpleValueSeed(parsed, bucket.length + 1));
    valuesByType.set(currentType, bucket);
  }
}

function buildStateLookup(stateRows: RawRow[]): Map<string, string> {
  const lookup = new Map<string, string>();
  let currentType = 'State';

  for (const raw of stateRows) {
    const parsed = parseRow(raw);
    if (!parsed) {
      continue;
    }
    if (parsed.metadataTypeCode) {
      currentType = parsed.metadataTypeCode.trim();
    }
    if (currentType !== 'State') {
      continue;
    }

    const country = parsed.applicableCountries?.[0];
    const original = parsed.originalStateCode?.trim().toUpperCase();
    if (country && original) {
      lookup.set(`${country}:${original}`, parsed.metadataValueCode.trim().toUpperCase());
    }
  }

  return lookup;
}

function promoteToRichValues(
  valuesByType: Map<string, SimpleValueSeed[]>,
  stateLookup: Map<string, string>,
): { richValues: RichValueSeed[]; richValueTypeByCode: Record<string, string> } {
  const richValues: RichValueSeed[] = [];
  const richValueTypeByCode: Record<string, string> = {};
  const richCodesByType = new Map<string, Set<string>>();

  function promote(typeCode: string, code: string, rich: RichValueSeed): void {
    richValues.push(rich);
    richValueTypeByCode[code] = typeCode;
    if (!richCodesByType.has(typeCode)) {
      richCodesByType.set(typeCode, new Set());
    }
    richCodesByType.get(typeCode)!.add(code);
  }

  for (const [conditionCode, categoryCode] of Object.entries(CONDITION_CATEGORY_RELATIONS)) {
    const seed = valuesByType.get('Condition')?.find((v) => v.metadataValueCode === conditionCode);
    if (!seed) {
      continue;
    }
    promote('Condition', conditionCode, {
      ...seed,
      relationships: [{ targetMetadataValueCode: categoryCode }],
    });
  }

  for (const seed of valuesByType.get('State') ?? []) {
    const country = seed.applicableCountries?.[0];
    if (!country) {
      continue;
    }
    promote('State', seed.metadataValueCode, {
      ...seed,
      relationships: [{ targetMetadataValueCode: country }],
    });
  }

  for (const seed of valuesByType.get('City') ?? []) {
    const country = seed.applicableCountries?.[0];
    const statePrefix = seed.metadataValueCode.split('_')[0]?.toUpperCase();
    if (!country || !statePrefix) {
      continue;
    }
    const stateCode = stateLookup.get(`${country}:${statePrefix}`);
    if (!stateCode) {
      continue;
    }
    promote('City', seed.metadataValueCode, {
      ...seed,
      relationships: [{ targetMetadataValueCode: stateCode }],
    });
  }

  for (const seed of valuesByType.get('MetricCode') ?? []) {
    const attrs = METRIC_VALUE_ATTRIBUTES[seed.metadataValueCode];
    if (!attrs) {
      continue;
    }
    promote('MetricCode', seed.metadataValueCode, {
      ...seed,
      valueAttributes: attrs,
    });
  }

  for (const [typeCode, codes] of richCodesByType) {
    const bucket = valuesByType.get(typeCode);
    if (!bucket) {
      continue;
    }
    valuesByType.set(
      typeCode,
      bucket.filter((seed) => !codes.has(seed.metadataValueCode)),
    );
  }

  return { richValues, richValueTypeByCode };
}

function ensureReferencedApplicableModules(valuesByType: Map<string, SimpleValueSeed[]>): void {
  const existing = new Set(
    (valuesByType.get('ApplicableModule') ?? []).map((seed) => seed.metadataValueCode),
  );
  const referenced = new Set<string>();

  for (const seeds of valuesByType.values()) {
    for (const seed of seeds) {
      for (const moduleCode of seed.applicableModules ?? []) {
        referenced.add(moduleCode);
      }
    }
  }

  const bucket = valuesByType.get('ApplicableModule') ?? [];
  for (const moduleCode of referenced) {
    if (existing.has(moduleCode)) {
      continue;
    }
    bucket.push({
      metadataValueCode: moduleCode,
      label: humanizeMetadataTypeCode(moduleCode),
      isGlobal: true,
      sortOrder: bucket.length + 1,
    });
    existing.add(moduleCode);
  }

  if (bucket.length) {
    valuesByType.set('ApplicableModule', bucket);
  }
}

function buildDependencyOrder(typeOrder: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const push = (code: string) => {
    if (!seen.has(code)) {
      seen.add(code);
      ordered.push(code);
    }
  };

  push('ApplicableModule');

  for (const code of typeOrder) {
    push(code);
  }

  const relationDeps: Record<string, string> = {
    Condition: 'Category',
    State: 'Country',
    City: 'State',
    Currency: 'Country',
    Device: 'Vital',
    MetricCode: 'QuestionType',
    QuestionCode: 'QuestionType',
  };

  for (const [dependent, prerequisite] of Object.entries(relationDeps)) {
    if (!seen.has(dependent)) {
      continue;
    }
    const depIndex = ordered.indexOf(dependent);
    const preIndex = ordered.indexOf(prerequisite);
    if (preIndex === -1) {
      ordered.splice(Math.max(0, depIndex), 0, prerequisite);
      seen.add(prerequisite);
      continue;
    }
    if (preIndex > depIndex) {
      ordered.splice(preIndex, 1);
      ordered.splice(depIndex, 0, prerequisite);
    }
  }

  return ordered;
}

export function loadMetadataCatalogFromExcel(excelPath?: string): LoadedMetadataCatalog {
  const resolvedPath = excelPath ?? resolveMetadataExcelPath();
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Metadata Excel file not found: ${resolvedPath}`);
  }

  const workbook = XLSX.readFile(resolvedPath);
  const typeOrder: string[] = [];
  const valuesByType = new Map<string, SimpleValueSeed[]>();

  ingestSheetRows(readSheetRows(workbook, MAIN_SHEET), valuesByType, typeOrder, {
    skipPlaceholders: true,
  });
  ingestSheetRows(readSheetRows(workbook, STATE_SHEET), valuesByType, typeOrder);
  ingestSheetRows(readSheetRows(workbook, CITY_SHEET), valuesByType, typeOrder);

  ensureReferencedApplicableModules(valuesByType);

  const stateLookup = buildStateLookup(readSheetRows(workbook, STATE_SHEET));
  const { richValues, richValueTypeByCode } = promoteToRichValues(valuesByType, stateLookup);

  const finalTypeOrder = buildDependencyOrder(typeOrder);
  const typeDefinitions = finalTypeOrder.map((code) => resolveMetadataTypeDefinition(code));

  for (const code of finalTypeOrder) {
    if (!typeDefinitions.find((def) => def.metadataTypeCode === code)) {
      typeDefinitions.push(defaultMetadataTypeDefinition(code));
    }
  }

  const simpleValuesByType: Record<string, SimpleValueSeed[]> = {};
  for (const [typeCode, seeds] of valuesByType) {
    if (seeds.length) {
      simpleValuesByType[typeCode] = seeds;
    }
  }

  return {
    excelPath: resolvedPath,
    typeOrder: finalTypeOrder,
    typeDefinitions,
    simpleValuesByType,
    richValues,
    richValueTypeByCode,
  };
}

export function getLoadedMetadataCatalog(): LoadedMetadataCatalog {
  if (!cachedCatalog) {
    cachedCatalog = loadMetadataCatalogFromExcel();
  }
  return cachedCatalog;
}

export function resetMetadataCatalogCache(): void {
  cachedCatalog = null;
}

export function catalogToJson(catalog: LoadedMetadataCatalog): string {
  return JSON.stringify(
    {
      excelPath: catalog.excelPath,
      typeOrder: catalog.typeOrder,
      typeDefinitions: catalog.typeDefinitions,
      simpleValuesByType: catalog.simpleValuesByType,
      richValues: catalog.richValues,
      richValueTypeByCode: catalog.richValueTypeByCode,
    },
    null,
    2,
  );
}
