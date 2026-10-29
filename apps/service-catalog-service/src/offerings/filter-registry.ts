import { ValidationError } from '@api-hub/utils';

import { assertVehicleType } from '../domain/catalog-validation';
import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import {
  calculateRelevance,
  haversineKm,
  normalizeSearch,
} from '../utils/helpers/catalog-admin';
import {
  FILTER_OPERATOR,
  FilterClause,
  FilterOperator,
  FilterValue,
  MAX_IN_VALUES,
  OFFERING_STATUS,
  OfferingCandidate,
  ParsedOfferingsQuery,
  offeringKey,
} from './types';
import { logger } from '@api-hub/observability';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;

export interface FilterDefinition {
  field: string;
  operators: readonly FilterOperator[];
  /** Equality on this field selects the discovery partition. */
  partition?: 'category';
  parse: (operator: FilterOperator, raw: string) => FilterValue;
}

/**
 * Client filters. Marketplace eligibility (active, approved, operational,
 * finite price) is applied with these and is not client-overridable.
 * `availableOn` is resolved after this registry, against Availability.
 */
export const OFFERING_FILTERS: readonly FilterDefinition[] = [
  {
    field: 'categoryId',
    operators: [FILTER_OPERATOR.EQ],
    partition: 'category',
    parse: (_operator, raw) => assertId(raw, 'categoryId'),
  },
  {
    field: 'vehicleType',
    operators: [FILTER_OPERATOR.EQ, FILTER_OPERATOR.IN],
    parse: (operator, raw) => parseVehicleFilter(operator, raw),
  },
  {
    field: 'vendorId',
    operators: [FILTER_OPERATOR.EQ, FILTER_OPERATOR.IN],
    parse: (operator, raw) => parseIdFilter(operator, raw, 'vendorId'),
  },
  {
    field: 'branchId',
    operators: [FILTER_OPERATOR.EQ, FILTER_OPERATOR.IN],
    parse: (operator, raw) => parseIdFilter(operator, raw, 'branchId'),
  },
  {
    field: 'price',
    operators: [FILTER_OPERATOR.GTE, FILTER_OPERATOR.LTE, FILTER_OPERATOR.BETWEEN],
    parse: (operator, raw) => parseMoneyFilter(operator, raw, 'price'),
  },
  {
    field: 'rating',
    operators: [FILTER_OPERATOR.GTE],
    parse: (_operator, raw) => parseRating(raw),
  },
  {
    field: 'status',
    operators: [FILTER_OPERATOR.EQ],
    parse: (_operator, raw) => parseStatus(raw),
  },
];

const FILTERS_BY_FIELD = new Map(OFFERING_FILTERS.map((definition) => [definition.field, definition]));

export function filterDefinition(field: string): FilterDefinition {
  const definition = FILTERS_BY_FIELD.get(field);
  if (!definition) {
    throw new ValidationError(`Unsupported filter field: ${field}`);
  }
  return definition;
}

export function parseFilterClause(
  field: string,
  operator: string,
  raw: string,
): FilterClause {
  const definition = filterDefinition(field);
  if (!definition.operators.includes(operator as FilterOperator)) {
    throw new ValidationError(`Unsupported operator ${operator} for ${field}`);
  }
  return {
    field,
    operator: operator as FilterOperator,
    value: definition.parse(operator as FilterOperator, raw),
  };
}

export function selectedVehicleTypes(clauses: readonly FilterClause[]): string[] {
  const clause = clauses.find((item) => item.field === 'vehicleType');
  if (!clause) {
    return [];
  }
  if (typeof clause.value === 'string') {
    return [clause.value];
  }
  if (isStringList(clause.value)) {
    return [...clause.value];
  }
  return [];
}

/**
 * Applies registry filters, search, and radius to a complete discovery partition.
 * Rows that fail marketplace eligibility never become candidates.
 */
export function applyCatalogFilters(
  items: readonly ServiceDiscoveryEntity[],
  query: ParsedOfferingsQuery,
): OfferingCandidate[] {
  const selected = selectedVehicleTypes(query.clauses);
  const matches: OfferingCandidate[] = [];

  for (const entity of items) {
    logger.info({ event: 'applyCatalogFiltersentity', entity });
    if (!isMarketplaceEligible(entity)) {
      continue;
    }
    if (!matchesClauses(entity, query.clauses)) {
      continue;
    }

    const priced = resolvePrice(entity, selected);
    if (!priced) {
      continue;
    }
    if (!matchesPrice(priced.displayPrice, query.clauses)) {
      continue;
    }
    if (!matchesRating(entity, query.clauses)) {
      continue;
    }

    const relevanceScore = calculateRelevance(entity, [...query.searchTerms]);
    if (query.searchTerms.length > 0 && relevanceScore === 0) {
      continue;
    }

    const distanceKm = query.location
      ? distanceWithin(entity, query.location.latitude, query.location.longitude, query.location.radiusKm)
      : undefined;
    if (query.location && distanceKm === undefined) {
      continue;
    }

    matches.push({
      entity,
      displayPrice: priced.displayPrice,
      durationMinutes: priced.durationMinutes,
      vehicleTypes: priced.vehicleTypes,
      ...(distanceKm === undefined ? {} : { distanceKm }),
      relevanceScore,
      offeringKey: offeringKey(entity),
    });
  }

  return matches;
}

function isMarketplaceEligible(entity: ServiceDiscoveryEntity): boolean {
  return entity.entityType === 'SERVICE_DISCOVERY'
    && entity.active === true
    && entity.vendorApproved === true 
}

function matchesClauses(
  entity: ServiceDiscoveryEntity,
  clauses: readonly FilterClause[],
): boolean {
  for (const clause of clauses) {
    if (clause.field === 'price' || clause.field === 'rating' || clause.field === 'status') {
      continue;
    }
    if (clause.field === 'categoryId' && entity.categoryId !== clause.value) {
      return false;
    }
    if (clause.field === 'vendorId' && !idMatches(entity.vendorId, clause)) {
      return false;
    }
    if (clause.field === 'branchId' && !idMatches(entity.branchId, clause)) {
      return false;
    }
    if (clause.field === 'vehicleType' && !vehicleMatches(entity, clause)) {
      return false;
    }
  }
  return true;
}

function idMatches(actual: string, clause: FilterClause): boolean {
  if (clause.operator === FILTER_OPERATOR.EQ) {
    return actual === clause.value;
  }
  return isStringList(clause.value) && clause.value.includes(actual);
}

function vehicleMatches(entity: ServiceDiscoveryEntity, clause: FilterClause): boolean {
  const types = entity.vehicleTypes ?? [];
  if (clause.operator === FILTER_OPERATOR.EQ) {
    return typeof clause.value === 'string' && types.includes(clause.value);
  }
  return isStringList(clause.value) && clause.value.some((type) => types.includes(type));
}

function resolvePrice(
  entity: ServiceDiscoveryEntity,
  selected: readonly string[],
): { displayPrice: number; durationMinutes: number; vehicleTypes: string[] } | undefined {
  const prices = entity.displayPricesByVehicleType ?? {};
  if (selected.length === 0) {
    if (Object.keys(prices).length === 0 || !Number.isFinite(entity.basePrice)) {
      return undefined;
    }
    return {
      displayPrice: entity.basePrice,
      durationMinutes: entity.durationMinutes,
      vehicleTypes: [...(entity.vehicleTypes ?? [])],
    };
  }

  const priced = selected
    .filter((type) => (entity.vehicleTypes ?? []).includes(type))
    .map((type) => {
      const price = prices[type];
      return typeof price === 'number' && Number.isFinite(price) ? { type, price } : undefined;
    })
    .filter((entry): entry is { type: string; price: number } => entry !== undefined);

  if (priced.length === 0) {
    return undefined;
  }

  const displayPrice = Math.min(...priced.map((entry) => entry.price));
  const durations = priced.map((entry) => entity.durationMinutesByVehicleType?.[entry.type])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return {
    displayPrice,
    durationMinutes: durations.length > 0 ? Math.min(...durations) : entity.durationMinutes,
    vehicleTypes: priced.map((entry) => entry.type),
  };
}

function matchesPrice(price: number, clauses: readonly FilterClause[]): boolean {
  for (const clause of clauses) {
    if (clause.field !== 'price') {
      continue;
    }
    if (clause.operator === FILTER_OPERATOR.GTE && typeof clause.value === 'number' && price < clause.value) {
      return false;
    }
    if (clause.operator === FILTER_OPERATOR.LTE && typeof clause.value === 'number' && price > clause.value) {
      return false;
    }
    if (clause.operator === FILTER_OPERATOR.BETWEEN && isMoneyPair(clause.value)) {
      if (price < clause.value[0] || price > clause.value[1]) {
        return false;
      }
    }
  }
  return true;
}

function matchesRating(entity: ServiceDiscoveryEntity, clauses: readonly FilterClause[]): boolean {
  const rating = entity.rating ?? 0;
  for (const clause of clauses) {
    if (clause.field === 'rating' && typeof clause.value === 'number' && rating < clause.value) {
      return false;
    }
    if (clause.field === 'status' && clause.value === OFFERING_STATUS.ACTIVE && entity.active !== true) {
      return false;
    }
  }
  return true;
}

function distanceWithin(
  entity: ServiceDiscoveryEntity,
  latitude: number,
  longitude: number,
  radiusKm: number,
): number | undefined {
  if (
    !Number.isFinite(entity.latitude)
    || !Number.isFinite(entity.longitude)
    || !Number.isFinite(entity.serviceRadiusKm)
  ) {
    return undefined;
  }
  const distanceKm = roundDistance(haversineKm(
    latitude,
    longitude,
    entity.latitude as number,
    entity.longitude as number,
  ));
  if (distanceKm > radiusKm || distanceKm > (entity.serviceRadiusKm as number)) {
    return undefined;
  }
  return distanceKm;
}

function roundDistance(distanceKm: number): number {
  return Math.round(distanceKm * 10000) / 10000;
}

function parseVehicleFilter(operator: FilterOperator, raw: string): FilterValue {
  const values = splitList(raw);
  if (operator === FILTER_OPERATOR.EQ) {
    if (values.length !== 1) {
      throw new ValidationError('vehicleType accepts one value');
    }
    return assertVehicleType(values[0]);
  }
  return assertList(values, 'vehicleType').map((value) => assertVehicleType(value));
}

function parseIdFilter(operator: FilterOperator, raw: string, field: string): FilterValue {
  const values = splitList(raw);
  if (operator === FILTER_OPERATOR.EQ) {
    if (values.length !== 1) {
      throw new ValidationError(`${field} accepts one value`);
    }
    return assertId(values[0], field);
  }
  return assertList(values, field).map((value) => assertId(value, field));
}

function parseMoneyFilter(operator: FilterOperator, raw: string, field: string): FilterValue {
  if (operator === FILTER_OPERATOR.BETWEEN) {
    const parts = splitList(raw);
    if (parts.length !== 2) {
      throw new ValidationError(`${field} between requires two amounts`);
    }
    const minimum = parseMoney(parts[0], field);
    const maximum = parseMoney(parts[1], field);
    if (minimum > maximum) {
      throw new ValidationError(`${field} minimum cannot exceed maximum`);
    }
    return [minimum, maximum];
  }
  return parseMoney(raw, field);
}

function parseMoney(raw: string, field: string): number {
  const trimmed = raw.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new ValidationError(`${field} must be a non-negative amount with at most two decimal places`);
  }
  return Number(trimmed);
}

function parseRating(raw: string): number {
  const trimmed = raw.trim();
  if (!/^(?:[0-4](?:\.\d+)?|5(?:\.0+)?)$/.test(trimmed)) {
    throw new ValidationError('rating must be a number from 0 to 5');
  }
  const rating = Number(trimmed);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    throw new ValidationError('rating must be a number from 0 to 5');
  }
  return rating;
}

function parseStatus(raw: string): string {
  const status = raw.trim().toLowerCase();
  if (status !== OFFERING_STATUS.ACTIVE) {
    throw new ValidationError('Unsupported offering status');
  }
  return OFFERING_STATUS.ACTIVE;
}

export function assertId(raw: string, field: string): string {
  const trimmed = raw.trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw new ValidationError(`${field} is invalid`);
  }
  return trimmed;
}

function assertList(values: string[], field: string): string[] {
  if (values.length === 0) {
    throw new ValidationError(`${field} requires a value`);
  }
  if (values.length > MAX_IN_VALUES) {
    throw new ValidationError(`${field} accepts at most ${MAX_IN_VALUES} values`);
  }
  if (new Set(values).size !== values.length) {
    throw new ValidationError(`${field} contains a duplicate value`);
  }
  return values;
}

function splitList(raw: string): string[] {
  return raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

function isStringList(value: FilterValue): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMoneyPair(value: FilterValue): value is readonly [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number';
}

export function normalizeOfferingSearch(value: string): string {
  return normalizeSearch(value);
}
