import * as fs from 'node:fs';
import * as path from 'node:path';

import * as XLSX from 'xlsx';

import {
  defaultMetadataTypeDefinition,
  humanizeMetadataTypeCode,
  resolveMetadataTypeDefinition,
} from '../catalog/type-overrides';
import { enrichCatalogTypeDefinitions } from '../catalog/type-modules-from-values';
import type {
  MetadataTypeSeedDefinition,
  RichValueSeed,
  SimpleValueSeed,
  ValueDataTypeSeed,
} from '../interfaces';

const DEFAULT_EXCEL_FILE = 'Complete metadata (1).xlsx';
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

/** Excel may use British spelling; canonical metadata type code is `Specialty`. */
const METADATA_TYPE_CODE_ALIASES: Record<string, string> = {
  Speciality: 'Specialty',
};

export function normalizeMetadataTypeCode(code: string): string {
  const trimmed = code.trim();
  return METADATA_TYPE_CODE_ALIASES[trimmed] ?? trimmed;
}

function canonicalizeTypeHint(hint: ExcelTypeHint): ExcelTypeHint {
  const metadataTypeCode = normalizeMetadataTypeCode(hint.metadataTypeCode);
  const displayName =
    metadataTypeCode === 'Specialty' && (!hint.displayName || hint.displayName.trim() === 'Speciality')
      ? 'Specialty'
      : hint.displayName;
  return {
    ...hint,
    metadataTypeCode,
    ...(displayName ? { displayName } : {}),
  };
}

/**
 * ServiceType → Specialty edges applied when matching ServiceType value codes exist in Excel.
 * Skipped when the ServiceType value is absent from the catalog.
 */
export const SERVICE_TYPE_SPECIALTY_RELATIONS: Record<string, string[]> = {
  CONSULTATION: [
    'CARDIOLOGY',
    'ENDOCRINOLOGY',
    'HEMATOLOGY',
    'NEPHROLOGY',
    'PULMONOLOGY',
    'RHEUMATOLOGY',
    'FAMILY_MEDICINE',
    'INTERNAL_MEDICINE',
    'OBS_AND_GYN',
    'DERMATOLOGY',
    'PSYCHIATRY',
    'PEDIATRIC',
    'GERIATRICIAN',
    'IMMUNOLOGY',
    'UROLOGY',
    'GASTROENTEROLOGY',
    'NEUROLOGY',
    'ONCOLOGY',
    'ENT',
    'ORTHOPAEDIST',
    'OPHTHALMOLOGY',
    'ODONTOLOGY',
    'GENERAL',
  ],
  REVIEW: [
    'CARDIOLOGY',
    'ENDOCRINOLOGY',
    'NEPHROLOGY',
    'PULMONOLOGY',
    'INTERNAL_MEDICINE',
    'FAMILY_MEDICINE',
    'GERIATRICIAN',
    'GENERAL',
  ],
  LAB_REVIEW: [
    'HEMATOLOGY',
    'ENDOCRINOLOGY',
    'NEPHROLOGY',
    'INTERNAL_MEDICINE',
    'FAMILY_MEDICINE',
    'BASIC_BLOOD',
    'DIABETES_SCREENING',
    'FULL_BODY_CHECKUP',
  ],
  PROCEDURE: [
    'SURGERY',
    'DERMATOLOGY',
    'UROLOGY',
    'GASTROENTEROLOGY',
    'ENT',
    'ORTHOPAEDIST',
    'OPHTHALMOLOGY',
    'ODONTOLOGY',
    'OBS_AND_GYN',
  ],
  EDUCATION: [
    'CARDIOLOGY',
    'ENDOCRINOLOGY',
    'PULMONOLOGY',
    'NEPHROLOGY',
    'DIETICIAN',
    'FITNESS',
    'FAMILY_MEDICINE',
    'INTERNAL_MEDICINE',
    'GENERAL',
  ],
  MONITORING: [
    'CARDIOLOGY',
    'ENDOCRINOLOGY',
    'NEPHROLOGY',
    'PULMONOLOGY',
    'FAMILY_MEDICINE',
    'INTERNAL_MEDICINE',
    'GERIATRICIAN',
    'FITNESS',
    'GENERAL',
  ],
  OTHER: ['GENERAL', 'FAMILY_MEDICINE', 'INTERNAL_MEDICINE'],
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
  displayname: 'displayName',
  metadatavalue: 'metadataValueCode',
  valuedatatype: 'valueDataType',
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
  displayName?: string;
  valueDataType?: ValueDataTypeSeed;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
  originalStateCode?: string;
  countryLabel?: string;
}

/** Type-level hints from Excel rows that declare a metadata type without value rows. */
interface ExcelTypeHint {
  metadataTypeCode: string;
  displayName?: string;
  valueDataType?: ValueDataTypeSeed;
  applicableModules?: string[];
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

function parseValueDataType(raw: unknown): ValueDataTypeSeed | undefined {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text === 'enum') {
    return 'Enum';
  }
  if (text === 'numeric') {
    return 'Numeric';
  }
  if (text === 'boolean') {
    return 'Boolean';
  }
  if (text === 'text') {
    return 'Text';
  }
  return undefined;
}

function mapRawRow(raw: RawRow): Partial<ParsedRow> {
  const mapped: Partial<ParsedRow> = {};
  for (const [header, value] of Object.entries(raw)) {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (!key) {
      continue;
    }
    if (key === 'valueDataType') {
      const parsed = parseValueDataType(value);
      if (parsed) {
        mapped.valueDataType = parsed;
      }
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
  return mapped;
}

/** Registers a metadata type from a header row (Metadata Type set, Metadata Value empty). */
function parseTypeHeaderRow(raw: RawRow): ExcelTypeHint | null {
  const mapped = mapRawRow(raw);
  const rawTypeCode = mapped.metadataTypeCode?.trim();
  if (!rawTypeCode || mapped.metadataValueCode) {
    return null;
  }

  const metadataTypeCode = normalizeMetadataTypeCode(rawTypeCode);
  const displayName = mapped.displayName?.trim() || mapped.label?.trim();
  return canonicalizeTypeHint({
    metadataTypeCode,
    ...(displayName ? { displayName } : {}),
    ...(mapped.valueDataType ? { valueDataType: mapped.valueDataType } : {}),
    ...(mapped.applicableModules?.length ? { applicableModules: mapped.applicableModules } : {}),
  });
}

function registerTypeHint(typeHintsByCode: Map<string, ExcelTypeHint>, hint: ExcelTypeHint): void {
  const existing = typeHintsByCode.get(hint.metadataTypeCode);
  if (!existing) {
    typeHintsByCode.set(hint.metadataTypeCode, hint);
    return;
  }
  typeHintsByCode.set(hint.metadataTypeCode, {
    metadataTypeCode: hint.metadataTypeCode,
    displayName: hint.displayName ?? existing.displayName,
    valueDataType: hint.valueDataType ?? existing.valueDataType,
    applicableModules: hint.applicableModules ?? existing.applicableModules,
  });
}

function applyExcelTypeHint(
  def: MetadataTypeSeedDefinition,
  hint: ExcelTypeHint | undefined,
): MetadataTypeSeedDefinition {
  if (!hint) {
    return def;
  }

  const applicableModules = def.applicableModules ?? hint.applicableModules;
  const merged: MetadataTypeSeedDefinition = {
    ...def,
    displayName: hint.displayName?.trim() || def.displayName,
    valueDataType: hint.valueDataType ?? def.valueDataType,
  };

  if (applicableModules?.length) {
    merged.applicableModules = applicableModules;
    merged.valueApplicabilityConfig = {
      ...def.valueApplicabilityConfig,
      moduleScoped: true,
    };
  }

  return merged;
}

function parseRow(raw: RawRow): ParsedRow | null {
  const mapped = mapRawRow(raw);

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
  typeHintsByCode: Map<string, ExcelTypeHint>,
  options?: { skipPlaceholders?: boolean },
): void {
  let currentType = '';

  for (const raw of rows) {
    const typeHeader = parseTypeHeaderRow(raw);
    if (typeHeader) {
      currentType = typeHeader.metadataTypeCode;
      registerTypeHint(typeHintsByCode, typeHeader);
      if (!typeOrder.includes(currentType)) {
        typeOrder.push(currentType);
      }
      continue;
    }

    const parsed = parseRow(raw);
    if (!parsed) {
      continue;
    }

    if (parsed.metadataTypeCode) {
      currentType = normalizeMetadataTypeCode(parsed.metadataTypeCode);
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
    const seed = toSimpleValueSeed(parsed, bucket.length + 1);
    const existingIdx = bucket.findIndex((entry) => entry.metadataValueCode === seed.metadataValueCode);
    if (existingIdx >= 0) {
      bucket[existingIdx] = { ...seed, sortOrder: bucket[existingIdx].sortOrder };
    } else {
      bucket.push(seed);
    }
    valuesByType.set(currentType, bucket);
  }
}

function buildStateLookup(stateRows: RawRow[]): {
  byCountryAndOriginal: Map<string, string>;
  byMetadataValueCode: Map<string, string>;
} {
  const byCountryAndOriginal = new Map<string, string>();
  const byMetadataValueCode = new Map<string, string>();
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
    const metadataValueCode = parsed.metadataValueCode.trim().toUpperCase();
    byMetadataValueCode.set(metadataValueCode, metadataValueCode);
    if (country && original) {
      byCountryAndOriginal.set(`${country}:${original}`, metadataValueCode);
    }
  }

  return { byCountryAndOriginal, byMetadataValueCode };
}

/**
 * State key segment for `buildStateLookup` (`${country}:${segment}`).
 * Supports `OH_CITY`, `07_CITY`, and `US_TN_CITY` code shapes.
 */
export function resolveCityStateOriginalCode(country: string, cityCode: string): string | null {
  const normalizedCountry = country.trim().toUpperCase();
  const segments = cityCode
    .trim()
    .toUpperCase()
    .split('_')
    .filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  if (segments[0] === normalizedCountry && segments.length >= 3) {
    return segments[1] ?? null;
  }
  return segments[0] ?? null;
}

function resolveStateCodeForCity(
  stateLookup: ReturnType<typeof buildStateLookup>,
  country: string,
  cityCode: string,
): string | undefined {
  const stateOriginal = resolveCityStateOriginalCode(country, cityCode);
  if (!stateOriginal) {
    return undefined;
  }

  const fromOriginal = stateLookup.byCountryAndOriginal.get(`${country}:${stateOriginal}`);
  if (fromOriginal) {
    return fromOriginal;
  }

  return stateLookup.byMetadataValueCode.get(`${country}_${stateOriginal}`);
}

/** Country codes for Currency VALID_IN relationships (from Excel applicableCountries). */
export function resolveCountriesForCurrency(seed: SimpleValueSeed): string[] {
  if (seed.applicableCountries?.length) {
    return [
      ...new Set(
        seed.applicableCountries.map((token) => token.trim().toUpperCase()).filter(Boolean),
      ),
    ];
  }

  const code = seed.metadataValueCode.trim().toUpperCase();
  const parts = code.split('_').filter(Boolean);
  if (parts.length >= 2) {
    const suffix = parts[parts.length - 1]!;
    if (/^[A-Z]{2}$/.test(suffix)) {
      return [suffix];
    }
  }

  return [];
}

function promoteToRichValues(
  valuesByType: Map<string, SimpleValueSeed[]>,
  stateLookup: ReturnType<typeof buildStateLookup>,
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
    if (!country) {
      continue;
    }
    const stateCode = resolveStateCodeForCity(stateLookup, country, seed.metadataValueCode);
    if (!stateCode) {
      continue;
    }
    promote('City', seed.metadataValueCode, {
      ...seed,
      relationships: [{ targetMetadataValueCode: stateCode }],
    });
  }

  for (const seed of valuesByType.get('Currency') ?? []) {
    const countries = resolveCountriesForCurrency(seed);
    if (!countries.length) {
      continue;
    }
    promote('Currency', seed.metadataValueCode, {
      ...seed,
      relationships: countries.map((targetMetadataValueCode) => ({ targetMetadataValueCode })),
    });
  }

  for (const [serviceTypeCode, specialtyCodes] of Object.entries(SERVICE_TYPE_SPECIALTY_RELATIONS)) {
    const seed = valuesByType.get('ServiceType')?.find((v) => v.metadataValueCode === serviceTypeCode);
    if (!seed) {
      continue;
    }
    promote('ServiceType', serviceTypeCode, {
      ...seed,
      relationships: specialtyCodes.map((targetMetadataValueCode) => ({ targetMetadataValueCode })),
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

/** Large geography catalogs — seeded after all other types (Country must exist first). */
const DEFERRED_TO_END_TYPES = ['State', 'City'] as const;

function buildDependencyOrder(typeOrder: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const deferred = new Set<string>(DEFERRED_TO_END_TYPES);

  const push = (code: string) => {
    if (!seen.has(code)) {
      seen.add(code);
      ordered.push(code);
    }
  };

  push('ApplicableModule');
  // Override-only types (not in Excel) — needed for smoke / local testing (e.g. PackageType).
  push('PackageType');

  for (const code of typeOrder) {
    if (!deferred.has(code)) {
      push(code);
    }
  }

  const relationDeps: Record<string, string | string[]> = {
    Condition: 'Category',
    State: 'Country',
    City: 'State',
    Currency: 'Country',
    Device: 'Vital',
    ServiceType: 'Specialty',
    MetricCode: ['DataSourceType', 'EvaluationLogic', 'QuestionType'],
    QuestionCode: 'QuestionType',
  };

  for (const [dependent, prerequisiteOrList] of Object.entries(relationDeps)) {
    if (!seen.has(dependent)) {
      continue;
    }
    const prerequisites = Array.isArray(prerequisiteOrList)
      ? prerequisiteOrList
      : [prerequisiteOrList];
    for (const prerequisite of prerequisites) {
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
  }

  for (const code of DEFERRED_TO_END_TYPES) {
    if (typeOrder.includes(code)) {
      push(code);
    }
  }

  return ordered;
}

function ingestWorkbook(
  workbook: XLSX.WorkBook,
  valuesByType: Map<string, SimpleValueSeed[]>,
  typeOrder: string[],
  typeHintsByCode: Map<string, ExcelTypeHint>,
): RawRow[] {
  ingestSheetRows(readSheetRows(workbook, MAIN_SHEET), valuesByType, typeOrder, typeHintsByCode, {
    skipPlaceholders: true,
  });
  ingestSheetRows(readSheetRows(workbook, STATE_SHEET), valuesByType, typeOrder, typeHintsByCode);
  ingestSheetRows(readSheetRows(workbook, CITY_SHEET), valuesByType, typeOrder, typeHintsByCode);
  return readSheetRows(workbook, STATE_SHEET);
}

export function loadMetadataCatalogFromExcel(excelPath?: string): LoadedMetadataCatalog {
  const resolvedPath = excelPath ?? resolveMetadataExcelPath();
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Metadata Excel file not found: ${resolvedPath}`);
  }

  const workbook = XLSX.readFile(resolvedPath);
  const typeOrder: string[] = [];
  const typeHintsByCode = new Map<string, ExcelTypeHint>();
  const valuesByType = new Map<string, SimpleValueSeed[]>();
  const stateRows = ingestWorkbook(workbook, valuesByType, typeOrder, typeHintsByCode);

  ensureReferencedApplicableModules(valuesByType);

  const stateLookup = buildStateLookup(stateRows);
  const { richValues, richValueTypeByCode } = promoteToRichValues(valuesByType, stateLookup);

  const finalTypeOrder = buildDependencyOrder(typeOrder);
  const typeDefinitions = finalTypeOrder.map((code) =>
    applyExcelTypeHint(resolveMetadataTypeDefinition(code), typeHintsByCode.get(code)),
  );

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

  const catalog: LoadedMetadataCatalog = {
    excelPath: resolvedPath,
    typeOrder: finalTypeOrder,
    typeDefinitions,
    simpleValuesByType,
    richValues,
    richValueTypeByCode,
  };

  // Union modules from value rows (+ overrides / Excel type headers) onto each type definition.
  catalog.typeDefinitions = enrichCatalogTypeDefinitions(catalog);

  return catalog;
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
