import type { Applicability, MetadataValueRecord, Status, ValueSearchFilter } from '../models/types';
import { STATUS } from '../constants';

function intersects(filterVals: string[] | undefined, valueVals: string[] | undefined): boolean {
  if (!filterVals || filterVals.length === 0) {
    return true;
  }
  if (!valueVals || valueVals.length === 0) {
    return false;
  }
  const set = new Set(valueVals);
  return filterVals.some((f) => set.has(f));
}

/**
 * Applies Figma / requirements filter: OR within field, AND across fields.
 * `isGlobal` values always pass applicability checks.
 * When `defaultStatus` is `null`, do not constrain by record status unless `filter.status` is set.
 */
export function matchesSearchFilter(
  value: MetadataValueRecord,
  filter: ValueSearchFilter,
  defaultStatus: Status | null = STATUS.ACTIVE,
): boolean {
  if (defaultStatus !== null) {
    const statusFilter = (filter.status as Status | undefined) ?? defaultStatus;
    if (value.status !== statusFilter) {
      return false;
    }
  } else if (filter.status !== undefined && value.status !== filter.status) {
    return false;
  }

  if (value.isGlobal) {
    return true;
  }

  const a: Applicability = value.applicability;
  const f = filter;

  if (f.module && !intersects(f.module, a.module)) {
    return false;
  }
  if (f.category && !intersects(f.category, a.category)) {
    return false;
  }
  if (f.condition && !intersects(f.condition, a.condition)) {
    return false;
  }
  if (f.country && !intersects(f.country, a.country)) {
    return false;
  }
  if (f.language?.length && !intersects(f.language, a.language ?? [])) {
    return false;
  }

  return true;
}

export function sortValuesForSearch(values: MetadataValueRecord[]): MetadataValueRecord[] {
  return [...values].sort((a, b) => {
    const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (so !== 0) {
      return so;
    }
    return a.label.localeCompare(b.label);
  });
}
