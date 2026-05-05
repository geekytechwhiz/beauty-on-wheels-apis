import type { Status } from '../models/types';

/**
 * Parsed list-metadata request shape (must match host Zod `listMetadataSchema` output).
 */
export interface ListMetadataInput {
  entityType: 'type' | 'value';
  metadataTypeCode: string;
  module?: string;
  valueDataType?: string;
  /** Omitted → ACTIVE-only; `INACTIVE` → inactive-only; `includeInactive` wins when true. */
  status?: Status;
  includeInactive: boolean;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
  search?: string;
}
