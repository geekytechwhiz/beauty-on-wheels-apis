export type ValueDataType = 'Enum' | 'Numeric' | 'Boolean' | 'Text';

export type RegistryStatus = 'ACTIVE' | 'INACTIVE';

export interface AuditFields {
  createdAt: string;
  lastModifiedAt: string;
  createdBy?: string;
  lastModifiedBy?: string;
}

export interface MetadataType extends AuditFields {
  metadataTypeCode: string;
  displayName: string;
  description?: string;
  valueDataType: ValueDataType;
  multiSelectAllowed: boolean;
  applicableModules: string[];
  attributeSchema?: Record<string, unknown>;
  status: RegistryStatus;
  version: number;
}

export interface MetadataValue extends AuditFields {
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
}

export interface ApplicabilityContext {
  module?: string;
  category?: string;
  condition?: string;
  country?: string;
}
