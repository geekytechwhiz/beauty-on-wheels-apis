/** Local catalog seed shapes for task-service metadata registry documentation. */

export type TaskMetadataValueDataType = 'Enum' | 'Numeric' | 'Boolean' | 'Text';

export type TaskMetadataRelationType =
  | 'PARENT_CHILD'
  | 'VALID_IN'
  | 'SUPPORTED_BY'
  | 'BELONGS_TO_CATEGORY'
  | 'ALLOWED_FOR';

export interface TaskMetadataValueApplicabilityConfig {
  moduleScoped?: boolean;
}

export interface TaskMetadataTypeRelationConfig {
  supportsRelations: true;
  relationType: TaskMetadataRelationType;
  targetMetadataTypeCode: string;
  relationFieldLabel: string;
  selectionMode: 'SINGLE' | 'MULTI';
  relationRequired: boolean;
}

export interface TaskMetadataTypeSeedDefinition {
  metadataTypeCode: string;
  displayName: string;
  valueDataType: TaskMetadataValueDataType;
  multiSelectAllowed: boolean;
  applicableModules: string[];
  status: 'ACTIVE' | 'INACTIVE';
  valueApplicabilityConfig?: TaskMetadataValueApplicabilityConfig;
  relation?: TaskMetadataTypeRelationConfig;
}

export interface TaskMetadataValueSeed {
  metadataValueCode: string;
  label: string;
  applicableModules: string[];
  sortOrder?: number;
}
