/**
 * Types for serverless-auto-swagger (bodyType / responseData).
 * Mirrors libs/metadata validators and domain types.
 */

/** Standard handler return for /health */
export interface HealthPayload {
  /** Always `ok` when the Lambda succeeds */
  status: string;
  service: string;
}

export type ValueDataType = 'Enum' | 'Numeric' | 'Boolean' | 'Text';
export type RegistryStatus = 'ACTIVE' | 'INACTIVE';

/** POST /metadata-types */
export interface CreateMetadataTypeRequest {
  /** Immutable logical key; PK METADATA_TYPE#{code} */
  metadataTypeCode: string;
  displayName: string;
  description?: string;
  valueDataType: ValueDataType;
  multiSelectAllowed: boolean;
  applicableModules: string[];
  /** JSON Schema for valueAttributes on values of this type */
  attributeSchema?: Record<string, unknown>;
  /** Optional; defaults from authorizer */
  createdBy?: string;
}

/** PUT /metadata-types/{metadataTypeCode} */
export interface UpdateMetadataTypeRequest {
  displayName?: string;
  description?: string;
  valueDataType?: ValueDataType;
  multiSelectAllowed?: boolean;
  applicableModules?: string[];
  attributeSchema?: Record<string, unknown>;
  status?: RegistryStatus;
  updatedBy?: string;
}

/** POST /metadata-types/{metadataTypeCode}/values */
export interface CreateMetadataValueRequest {
  metadataValueCode: string;
  label: string;
  description?: string;
  /** When true, writes a single GLOBAL applicability tuple */
  isGlobal: boolean;
  applicableModules: string[];
  applicableCategories: string[];
  applicableConditions: string[];
  applicableCountries: string[];
  valueAttributes: Record<string, unknown>;
  createdBy?: string;
}

/** PUT /metadata-types/{metadataTypeCode}/values/{metadataValueCode} */
export interface UpdateMetadataValueRequest {
  label?: string;
  description?: string;
  isGlobal?: boolean;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  valueAttributes?: Record<string, unknown>;
  status?: RegistryStatus;
  updatedBy?: string;
}

/** POST /metadata-types/validate-value */
export interface ValidateMetadataValueRequest {
  metadataTypeCode: string;
  metadataValueCode: string;
  context: ApplicabilityContextBody;
}

export interface ApplicabilityContextBody {
  module: string;
  category: string;
  condition: string;
  country: string;
}

/** Stored metadata type entity */
export interface MetadataType {
  metadataTypeCode: string;
  displayName: string;
  description?: string;
  valueDataType: ValueDataType;
  multiSelectAllowed: boolean;
  applicableModules: string[];
  attributeSchema?: Record<string, unknown>;
  status: RegistryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

/** Stored metadata value entity */
export interface MetadataValue {
  metadataTypeCode: string;
  metadataValueCode: string;
  label: string;
  description?: string;
  status: RegistryStatus;
  isGlobal: boolean;
  applicableModules: string[];
  applicableCategories: string[];
  applicableConditions: string[];
  applicableCountries: string[];
  valueAttributes: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

/** GET list endpoints — ApiResponse normalizes arrays to `{ items }` in `data` */
export interface MetadataTypeListPayload {
  items: MetadataType[];
}

export interface MetadataValueListPayload {
  items: MetadataValue[];
}

/** validateMetadataValue handler return */
export interface ValidateMetadataValuePayload {
  valid: boolean;
  /** Present when valid is false, e.g. APPLICABILITY_MISMATCH */
  reason?: string;
}
