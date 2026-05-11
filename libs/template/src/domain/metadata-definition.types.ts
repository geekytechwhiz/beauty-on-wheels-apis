/**
 * Registry entry stored in TemplateTable as METADATA#&lt;type&gt; / METADATA#&lt;name&gt;#&lt;version&gt;.
 */
export type MetadataFieldType = 'ENUM' | 'MULTI_ENUM' | 'NUMERIC' | 'BOOLEAN' | 'STRING';

export type MetadataModeKind = 'Fixed' | 'Expandable' | 'FixedDefaultExpandable';

export type MetadataStatus = 'ACTIVE' | 'INACTIVE';

export interface MetadataApplicability {
  templateType: string[];
  category: string[];
  condition: string[];
  country: string[];
}

export interface MetadataConstraints {
  minSelections?: number;
  maxSelections?: number;
  minValue?: number;
  maxValue?: number;
  regex?: string;
  /** Max string length for STRING type. */
  maxLength?: number;
  /** Min string length for STRING type. */
  minLength?: number;
}

export interface MetadataDefinition {
  name: string;
  type: MetadataFieldType;
  values?: string[];
  defaultValue?: unknown;
  metadataMode: MetadataModeKind;
  applicability: MetadataApplicability;
  constraints?: MetadataConstraints;
  status: MetadataStatus;
  version: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Runtime context used to filter registry entries (profile + config).
 */
export interface MetadataApplicabilityContext {
  templateType: string;
  category: string;
  condition: string;
  country: string;
}
