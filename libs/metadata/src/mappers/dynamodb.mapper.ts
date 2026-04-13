import { ENTITY_TYPE } from '../domain/constants';
import type { MetadataType, MetadataValue } from '../domain/types';
import {
  gsi1pkRegistryTypes,
  gsi1skMetadataType,
  pkMetadataType,
  skTypeMetadata,
  skValue,
} from '../repository/keys';

export type MetadataTypeItem = MetadataType & {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_TYPE;
  gsi1pk: string;
  gsi1sk: string;
  sk1: string; // status
  sk2: string; // createdAt
  sk3: string; // lastModifiedAt
  sk5: string; // entityType
};

export type MetadataValueItem = MetadataValue & {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_VALUE;
  sk1: string; // status
  sk2: string; // createdAt
  sk3: string; // lastModifiedAt
  sk4: string; // metadataValueCode
  sk5: string; // entityType
};

// Applicability is stored at Metadata Value level as per design; no separate METADATA_APPL entity required.

export function toMetadataTypeItem(type: MetadataType): MetadataTypeItem {
  const pk = pkMetadataType(type.metadataTypeCode);
  return {
    ...type,
    pk,
    sk: skTypeMetadata(),
    entityType: ENTITY_TYPE.METADATA_TYPE,
    gsi1pk: gsi1pkRegistryTypes(),
    gsi1sk: gsi1skMetadataType(type.metadataTypeCode),
    sk1: type.status,
    sk2: type.createdAt,
    sk3: type.lastModifiedAt,
    sk5: ENTITY_TYPE.METADATA_TYPE,
  };
}

export function toMetadataValueItem(value: MetadataValue): MetadataValueItem {
  return {
    ...value,
    pk: pkMetadataType(value.metadataTypeCode),
    sk: skValue(value.metadataValueCode),
    entityType: ENTITY_TYPE.METADATA_VALUE,
    sk1: value.status,
    sk2: value.createdAt,
    sk3: value.lastModifiedAt,
    sk4: value.metadataValueCode,
    sk5: ENTITY_TYPE.METADATA_VALUE,
  };
}

const INDEX_KEYS = ['pk', 'sk', 'entityType', 'gsi1pk', 'gsi1sk', 'sk1', 'sk2', 'sk3', 'sk4', 'sk5'];

function migrateAuditFields(rest: Record<string, unknown>): void {
  if (rest.lastModifiedAt === undefined && rest.updatedAt !== undefined) {
    rest.lastModifiedAt = rest.updatedAt;
  }
  delete rest.updatedAt;

  if (rest.lastModifiedBy === undefined && rest.updatedBy !== undefined) {
    rest.lastModifiedBy = rest.updatedBy;
  }
  delete rest.updatedBy;
}

export function fromMetadataTypeItem(item: Record<string, unknown>): MetadataType {
  const rest = { ...item };
  for (const k of INDEX_KEYS) delete rest[k];
  migrateAuditFields(rest);
  return rest as unknown as MetadataType;
}

export function fromMetadataValueItem(item: Record<string, unknown>): MetadataValue {
  const rest = { ...item };
  for (const k of INDEX_KEYS) delete rest[k];
  migrateAuditFields(rest);
  return rest as unknown as MetadataValue;
}
