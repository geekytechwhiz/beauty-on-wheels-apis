import type { MetadataType, MetadataValue } from './types';

export type MetadataRegistryEventType =
  | 'METADATA_TYPE_CREATED'
  | 'METADATA_TYPE_UPDATED'
  | 'METADATA_VALUE_CREATED'
  | 'METADATA_VALUE_UPDATED'
  | 'METADATA_VALUE_INACTIVATED'
  | 'METADATA_SCHEMA_UPDATED';

export interface MetadataRegistryEventBase {
  type: MetadataRegistryEventType;
  timestamp: string;
}

export interface MetadataTypeEvent extends MetadataRegistryEventBase {
  type: 'METADATA_TYPE_CREATED' | 'METADATA_TYPE_UPDATED' | 'METADATA_SCHEMA_UPDATED';
  metadataType: MetadataType;
}

export interface MetadataValueEvent extends MetadataRegistryEventBase {
  type:
    | 'METADATA_VALUE_CREATED'
    | 'METADATA_VALUE_UPDATED'
    | 'METADATA_VALUE_INACTIVATED';
  metadataTypeCode: string;
  metadataValue?: MetadataValue;
  metadataValueCode?: string;
}

export type MetadataRegistryEvent = MetadataTypeEvent | MetadataValueEvent;
