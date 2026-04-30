import {
  STATUS,
  ValidationError,
  assertEnumTokenArray,
  matchesSearchFilter,
  sortValuesForSearch,
  type Status,
  type ValueSearchFilter,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/middleware';
import { flattenMetadataValueForApi, listTypes, listValues, parseListEntityStatusMode } from '../services/metadataService';

type ListMetadataRequest = {
  params?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
};

function resolveEntityType(req: ListMetadataRequest): string {
  return String(req.params?.entityType ?? req.pathParameters?.entityType ?? '').trim();
}

/** Comma-separated or single query values → tokens (e.g. `RPM` or `RPM,OP`). */
function queryTokens(raw: string | undefined): string[] | undefined {
  if (raw === undefined || String(raw).trim() === '') {
    return undefined;
  }
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * Value list: default ACTIVE; optional INACTIVE. No free-text `search` param.
 */
function parseValueListStatus(q: Record<string, string | undefined>): Status {
  const raw = q.status;
  if (raw === undefined || String(raw).trim() === '') {
    return STATUS.ACTIVE;
  }
  const s = String(raw).trim().toUpperCase();
  if (s === STATUS.ACTIVE || s === STATUS.INACTIVE) {
    return s;
  }
  throw new ValidationError('status must be ACTIVE or INACTIVE', [{ field: 'status', message: 'Invalid' }]);
}

function buildValueListApplicabilityFilter(
  q: Record<string, string | undefined>,
  effectiveStatus: Status,
): ValueSearchFilter {
  if (q.search !== undefined && String(q.search).trim() !== '') {
    throw new ValidationError('search is not supported; use structured applicability query params', [
      { field: 'search', message: 'Not supported' },
    ]);
  }

  const filter: ValueSearchFilter = { status: effectiveStatus };

  const modules = queryTokens(q.applicableModules);
  if (modules?.length) {
    assertEnumTokenArray(modules, 'applicableModules');
    filter.module = modules;
  }
  const categories = queryTokens(q.applicableCategories);
  if (categories?.length) {
    assertEnumTokenArray(categories, 'applicableCategories');
    filter.category = categories;
  }
  const conditions = queryTokens(q.applicableConditions);
  if (conditions?.length) {
    assertEnumTokenArray(conditions, 'applicableConditions');
    filter.condition = conditions;
  }
  const countries = queryTokens(q.applicableCountries);
  if (countries?.length) {
    assertEnumTokenArray(countries, 'applicableCountries');
    filter.country = countries;
  }

  return filter;
}

export const main = withLambdaHandler(async (req: ListMetadataRequest) => {
  const entityType = resolveEntityType(req);
  if (!entityType) {
    throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
  }
  const kind = entityType.toLowerCase();
  const q = req.params ?? {};

  if (kind === 'type') {
    const mode = parseListEntityStatusMode(q);
    const base = {
      module: q.module,
      valueDataType: q.valueDataType ?? q.datatype,
    };
    if (mode === 'all') {
      return listTypes(base);
    }
    return listTypes({
      ...base,
      status: mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE,
    });
  }

  if (kind === 'value') {
    const metadataTypeCode = String(
      q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '',
    ).trim();
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }

    const effectiveStatus = parseValueListStatus(q);
    const filter = buildValueListApplicabilityFilter(q, effectiveStatus);

    const rows = await listValues(metadataTypeCode, effectiveStatus);
    const matched = rows.filter((v) => matchesSearchFilter(v, filter, effectiveStatus));
    return sortValuesForSearch(matched).map(flattenMetadataValueForApi);
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
}, { useCreated: false });
