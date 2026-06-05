import type { Status } from '../models/types';

/**
 * Parsed list-metadata request shape (must match host Zod `listMetadataSchema` output).
 */
export interface ListMetadataInput {
  entityType: 'type' | 'value';
  metadataTypeCode: string;
  /** Present only when using cursor pagination (or with `nextPaginationKey`). */
  limit?: number;
  nextPaginationKey?: string;
  module?: string;
  valueDataType?: string;
  /** Resolved from optional `status` query (ACTIVE, INACTIVE, DELETED, ALL). Default ACTIVE only. */
  lifecycleStatuses: Status[];
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
  search?: string;
}
