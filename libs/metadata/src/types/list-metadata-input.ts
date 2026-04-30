import type { Status } from '../models/types';

/**
 * Parsed list-metadata request shape (must match host Zod `listMetadataSchema` output).
 */
export interface ListMetadataInput {
  entityType: 'type' | 'value';
  metadataTypeCode: string;
  module?: string;
  valueDataType?: string;
  statusMode?: string;
  status: Status;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
  search?: string;
}
