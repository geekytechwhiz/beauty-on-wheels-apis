import {
  OfferingCandidate,
  SORT_DIRECTION,
  SORT_FIELD,
  SortDirection,
  SortField,
  SortSpec,
} from './types';

export const DEFAULT_SORT_DIRECTION: Record<SortField, SortDirection> = {
  [SORT_FIELD.PRICE]: SORT_DIRECTION.ASC,
  [SORT_FIELD.DISTANCE]: SORT_DIRECTION.ASC,
  [SORT_FIELD.RATING]: SORT_DIRECTION.DESC,
  [SORT_FIELD.POPULARITY]: SORT_DIRECTION.DESC,
  [SORT_FIELD.NAME]: SORT_DIRECTION.ASC,
  [SORT_FIELD.NEWEST]: SORT_DIRECTION.DESC,
  [SORT_FIELD.RELEVANCE]: SORT_DIRECTION.DESC,
};

const SORT_FIELDS = new Set<string>(Object.values(SORT_FIELD));

export function isSortField(value: string): value is SortField {
  return SORT_FIELDS.has(value);
}

export function compareOfferings(
  left: OfferingCandidate,
  right: OfferingCandidate,
  sorts: readonly SortSpec[],
): number {
  for (const sort of sorts) {
    const difference = compareValues(readSortValue(left, sort.field), readSortValue(right, sort.field));
    if (difference !== 0) {
      return sort.direction === SORT_DIRECTION.ASC ? difference : -difference;
    }
  }
  return left.offeringKey.localeCompare(right.offeringKey);
}

export function sortTuple(
  item: OfferingCandidate,
  sorts: readonly SortSpec[],
): Array<string | number> {
  return [
    ...sorts.map((sort) => readSortValue(item, sort.field)),
    item.offeringKey,
  ];
}

export function isAfterSortTuple(
  item: OfferingCandidate,
  tuple: readonly (string | number)[],
  sorts: readonly SortSpec[],
): boolean {
  const current = sortTuple(item, sorts);
  for (let index = 0; index < sorts.length; index += 1) {
    const difference = compareValues(current[index], tuple[index]);
    if (difference === 0) {
      continue;
    }
    const after = sorts[index].direction === SORT_DIRECTION.ASC ? difference > 0 : difference < 0;
    return after;
  }
  return String(current[sorts.length]).localeCompare(String(tuple[sorts.length])) > 0;
}

function readSortValue(item: OfferingCandidate, field: SortField): string | number {
  switch (field) {
    case SORT_FIELD.PRICE:
      return item.displayPrice;
    case SORT_FIELD.DISTANCE:
      return item.distanceKm ?? Number.POSITIVE_INFINITY;
    case SORT_FIELD.RATING:
      return item.entity.rating ?? 0;
    case SORT_FIELD.POPULARITY:
      return item.entity.reviewCount ?? 0;
    case SORT_FIELD.NAME:
      return item.entity.normalizedName || item.entity.name.toLowerCase();
    case SORT_FIELD.NEWEST:
      return item.entity.serviceUpdatedAt;
    case SORT_FIELD.RELEVANCE:
      return item.relevanceScore;
    default:
      return item.offeringKey;
  }
}

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}
