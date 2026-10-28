import { ValidationError } from '@api-hub/utils';

import { normalizeOfferingSearch, parseFilterClause } from './filter-registry';
import { DEFAULT_SORT_DIRECTION, isSortField } from './sort-registry';
import {
  DEFAULT_OFFERING_LIMIT,
  DEFAULT_RADIUS_KM,
  FILTER_OPERATOR,
  FilterClause,
  MAX_FILTER_CLAUSES,
  MAX_RADIUS_KM,
  MAX_SORT_FIELDS,
  ParsedOfferingsQuery,
  SORT_DIRECTION,
  SORT_FIELD,
  SortDirection,
  SortSpec,
} from './types';

const QUERY_FIELDS = new Set([
  'search',
  'categoryId',
  'vehicleType',
  'vendorId',
  'branchId',
  'latitude',
  'longitude',
  'radiusKm',
  'minPrice',
  'maxPrice',
  'minRating',
  'status',
  'availableOn',
  'startTime',
  'sort',
  'limit',
  'cursor',
  'filter',
  'communityId',
]);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function parseOfferingsQuery(input: unknown): ParsedOfferingsQuery {
  const source = isRecord(input) ? input : {};
  for (const key of Object.keys(source)) {
    if (!QUERY_FIELDS.has(key)) {
      throw new ValidationError(`Unsupported query parameter: ${key}`);
    }
  }

  const clauses: FilterClause[] = [];
  const friendlyFields = new Set<string>();
  const addFriendly = (clause: FilterClause): void => {
    clauses.push(clause);
    friendlyFields.add(clause.field);
  };

  const categoryId = optionalText(source.categoryId, 'categoryId');
  if (categoryId) {
    addFriendly(parseFilterClause('categoryId', FILTER_OPERATOR.EQ, categoryId));
  }
  const vehicleType = optionalText(source.vehicleType, 'vehicleType');
  if (vehicleType) {
    const operator = vehicleType.includes(',') ? FILTER_OPERATOR.IN : FILTER_OPERATOR.EQ;
    addFriendly(parseFilterClause('vehicleType', operator, vehicleType));
  }
  const vendorId = optionalText(source.vendorId, 'vendorId');
  if (vendorId) {
    const operator = vendorId.includes(',') ? FILTER_OPERATOR.IN : FILTER_OPERATOR.EQ;
    addFriendly(parseFilterClause('vendorId', operator, vendorId));
  }
  const branchId = optionalText(source.branchId, 'branchId');
  if (branchId) {
    const operator = branchId.includes(',') ? FILTER_OPERATOR.IN : FILTER_OPERATOR.EQ;
    addFriendly(parseFilterClause('branchId', operator, branchId));
  }
  if (present(source.minPrice)) {
    addFriendly(parseFilterClause('price', FILTER_OPERATOR.GTE, textValue(source.minPrice, 'minPrice')));
  }
  if (present(source.maxPrice)) {
    addFriendly(parseFilterClause('price', FILTER_OPERATOR.LTE, textValue(source.maxPrice, 'maxPrice')));
  }
  if (present(source.minRating)) {
    addFriendly(parseFilterClause('rating', FILTER_OPERATOR.GTE, textValue(source.minRating, 'minRating')));
  }
  const status = optionalText(source.status, 'status');
  if (status) {
    addFriendly(parseFilterClause('status', FILTER_OPERATOR.EQ, status));
  }

  for (const expression of filterExpressions(source.filter)) {
    const clause = parseFilterExpression(expression);
    if (friendlyFields.has(clause.field)) {
      throw new ValidationError(`Filter ${clause.field} is specified more than once`);
    }
    if (clauses.some((existing) => existing.field === clause.field && existing.operator === clause.operator)) {
      throw new ValidationError(`Filter ${clause.field} is specified more than once`);
    }
    clauses.push(clause);
  }

  if (clauses.length > MAX_FILTER_CLAUSES) {
    throw new ValidationError(`At most ${MAX_FILTER_CLAUSES} filters are allowed`);
  }

  const search = parseSearch(source.search);
  const location = parseLocation(source.latitude, source.longitude, source.radiusKm);
  const availableOn = parseDate(source.availableOn);
  const startTime = parseTime(source.startTime);
  if (startTime && !availableOn) {
    throw new ValidationError('availableOn is required when startTime is set');
  }

  const communityId = optionalText(source.communityId, 'communityId');
  if (communityId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(communityId)) {
    throw new ValidationError('Invalid communityId');
  }
  const sorts = parseSort(source.sort, Boolean(location), Boolean(search));
  const limit = parseLimit(source.limit);
  const cursor = optionalText(source.cursor, 'cursor');
  if (cursor && cursor.length > 2000) {
    throw new ValidationError('Invalid offerings cursor');
  }

  return {
    clauses,
    ...(search ? { search } : {}),
    searchTerms: search ? search.split(' ').filter(Boolean) : [],
    ...(location ? { location } : {}),
    ...(availableOn ? { availableOn } : {}),
    ...(startTime ? { startTime } : {}),
    sorts,
    limit,
    ...(cursor ? { cursor } : {}),
    ...(communityId ? { communityId } : {}),
  };
}

function parseFilterExpression(expression: string): FilterClause {
  const first = expression.indexOf(':');
  const second = expression.indexOf(':', first + 1);
  if (first <= 0 || second < 0) {
    throw new ValidationError('Filter must be field:operator:value');
  }
  const field = expression.slice(0, first).trim();
  const operator = expression.slice(first + 1, second).trim().toLowerCase();
  const raw = expression.slice(second + 1);
  if (!field || !operator || raw.trim().length === 0) {
    throw new ValidationError('Filter must be field:operator:value');
  }
  return parseFilterClause(field, operator, raw);
}

function parseSearch(value: unknown): string | undefined {
  if (!present(value)) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('search must be text');
  }
  if (CONTROL_CHARS.test(value)) {
    throw new ValidationError('search contains unsupported characters');
  }
  const normalized = normalizeOfferingSearch(value);
  if (normalized.length > 80) {
    throw new ValidationError('search must be at most 80 characters');
  }
  return normalized.length > 0 ? normalized : undefined;
}

function parseLocation(
  latitude: unknown,
  longitude: unknown,
  radiusKm: unknown,
): ParsedOfferingsQuery['location'] {
  const hasLatitude = present(latitude);
  const hasLongitude = present(longitude);
  const hasRadius = present(radiusKm);
  if (!hasLatitude && !hasLongitude && !hasRadius) {
    return undefined;
  }
  if (hasLatitude !== hasLongitude) {
    throw new ValidationError('latitude and longitude must be provided together');
  }
  if (!hasLatitude) {
    throw new ValidationError('latitude and longitude are required with radiusKm');
  }
  const lat = parseCoordinate(latitude, 'latitude', -90, 90);
  const lon = parseCoordinate(longitude, 'longitude', -180, 180);
  const radius = hasRadius ? parseRadius(radiusKm) : DEFAULT_RADIUS_KM;
  return { latitude: lat, longitude: lon, radiusKm: radius };
}

function parseDate(value: unknown): string | undefined {
  const text = optionalText(value, 'availableOn');
  if (!text) {
    return undefined;
  }
  const match = DATE_PATTERN.exec(text);
  if (!match) {
    throw new ValidationError('availableOn must be YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year
    || utc.getUTCMonth() !== month - 1
    || utc.getUTCDate() !== day
  ) {
    throw new ValidationError('availableOn must be YYYY-MM-DD');
  }
  return text;
}

function parseTime(value: unknown): string | undefined {
  const text = optionalText(value, 'startTime');
  if (!text) {
    return undefined;
  }
  if (!TIME_PATTERN.test(text)) {
    throw new ValidationError('startTime must be HH:mm');
  }
  return text;
}

function parseSort(value: unknown, hasLocation: boolean, hasSearch: boolean): SortSpec[] {
  const text = optionalText(value, 'sort');
  if (!text) {
    if (hasLocation) {
      return [{ field: SORT_FIELD.DISTANCE, direction: SORT_DIRECTION.ASC }];
    }
    if (hasSearch) {
      return [{ field: SORT_FIELD.RELEVANCE, direction: SORT_DIRECTION.DESC }];
    }
    return [{ field: SORT_FIELD.NEWEST, direction: SORT_DIRECTION.DESC }];
  }

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_SORT_FIELDS) {
    throw new ValidationError(`sort accepts 1 to ${MAX_SORT_FIELDS} fields`);
  }
  const sorts: SortSpec[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const [field, direction, extra] = part.split(':').map((piece) => piece.trim());
    if (!field || extra !== undefined || !isSortField(field)) {
      throw new ValidationError('Unsupported sort field');
    }
    if (seen.has(field)) {
      throw new ValidationError(`Sort field ${field} is repeated`);
    }
    seen.add(field);
    sorts.push({
      field,
      direction: parseDirection(field, direction),
    });
  }
  if (sorts.some((sort) => sort.field === SORT_FIELD.DISTANCE) && !hasLocation) {
    throw new ValidationError('Location is required for distance sorting');
  }
  return sorts;
}

function parseDirection(field: string, direction: string | undefined): SortDirection {
  if (!direction) {
    return DEFAULT_SORT_DIRECTION[field as keyof typeof DEFAULT_SORT_DIRECTION];
  }
  if (direction !== SORT_DIRECTION.ASC && direction !== SORT_DIRECTION.DESC) {
    throw new ValidationError('Sort direction must be asc or desc');
  }
  return direction;
}

function parseLimit(value: unknown): number {
  if (!present(value)) {
    return DEFAULT_OFFERING_LIMIT;
  }
  const parsed = typeof value === 'number' ? value : Number(textValue(value, 'limit'));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ValidationError('limit must be an integer between 1 and 50');
  }
  return parsed;
}

function parseCoordinate(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(textValue(value, field));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ValidationError(`${field} is out of range`);
  }
  return parsed;
}

function parseRadius(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(textValue(value, 'radiusKm'));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_RADIUS_KM) {
    throw new ValidationError(`radiusKm must be greater than 0 and at most ${MAX_RADIUS_KM}`);
  }
  return parsed;
}

function filterExpressions(value: unknown): string[] {
  if (!present(value)) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => {
    if (typeof entry !== 'string' || CONTROL_CHARS.test(entry) || entry.trim().length === 0) {
      throw new ValidationError('Filter must be field:operator:value');
    }
    return entry.trim();
  });
}

function optionalText(value: unknown, field: string): string | undefined {
  if (!present(value)) {
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`${field} is invalid`);
  }
  const text = String(value).trim();
  if (CONTROL_CHARS.test(text)) {
    throw new ValidationError(`${field} contains unsupported characters`);
  }
  return text.length > 0 ? text : undefined;
}

function textValue(value: unknown, field: string): string {
  const text = optionalText(value, field);
  if (!text) {
    throw new ValidationError(`${field} is invalid`);
  }
  return text;
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
