import { ENTITY_TYPE } from '../domain/constants';
import type { MetadataType, MetadataValue } from '../domain/types';
import {
  gsi1pkRegistryTypes,
  gsi1pkTypeValues,
  gsi1skMetadataType,
  gsi1skMetadataValue,
  gsi2skAppl,
  gsi2skMetadataType,
  gsi2skMetadataValue,
  pkMetadataType,
  skAppl,
  skTypeMetadata,
  skValue,
} from '../repository/keys';

export type MetadataTypeItem = MetadataType & {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_TYPE;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string; // entityType
  gsi2sk: string; // metadataTypeCode
  sk1: string; // status
  sk2: string; // createdAt
  sk3: string; // lastModifiedAt
  sk5: string; // entityType
};

export type MetadataValueItem = MetadataValue & {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_VALUE;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string; // entityType
  gsi2sk: string; // metadataTypeCode#metadataValueCode
  sk1: string; // status
  sk2: string; // createdAt
  sk3: string; // lastModifiedAt
  sk4: string; // metadataValueCode
  sk5: string; // entityType
};

export type MetadataApplItem = {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_APPL;
  metadataTypeCode: string;
  metadataValueCode: string;
  module: string;
  category: string;
  condition: string;
  country: string;
  gsi2pk: string; // entityType
  gsi2sk: string; // metadataTypeCode#metadataValueCode
  sk4: string; // metadataValueCode
  sk5: string; // entityType
};

export function toMetadataTypeItem(type: MetadataType): MetadataTypeItem {
  const pk = pkMetadataType(type.metadataTypeCode);
  return {
    ...type,
    pk,
    sk: skTypeMetadata(),
    entityType: ENTITY_TYPE.METADATA_TYPE,
    gsi1pk: gsi1pkRegistryTypes(),
    gsi1sk: gsi1skMetadataType(type.metadataTypeCode),
    gsi2pk: ENTITY_TYPE.METADATA_TYPE,
    gsi2sk: gsi2skMetadataType(type.metadataTypeCode),
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
    gsi1pk: gsi1pkTypeValues(value.metadataTypeCode),
    gsi1sk: gsi1skMetadataValue(value.status, value.metadataValueCode),
    gsi2pk: ENTITY_TYPE.METADATA_VALUE,
    gsi2sk: gsi2skMetadataValue(value.metadataTypeCode, value.metadataValueCode),
    sk1: value.status,
    sk2: value.createdAt,
    sk3: value.lastModifiedAt,
    sk4: value.metadataValueCode,
    sk5: ENTITY_TYPE.METADATA_VALUE,
  };
}

export function toApplItem(
  metadataTypeCode: string,
  metadataValueCode: string,
  tuple: [string, string, string, string],
): MetadataApplItem {
  const [module, category, condition, country] = tuple;
  return {
    pk: pkMetadataType(metadataTypeCode),
    sk: skAppl(module, category, condition, country, metadataValueCode),
    entityType: ENTITY_TYPE.METADATA_APPL,
    metadataTypeCode,
    metadataValueCode,
    module,
    category,
    condition,
    country,
    gsi2pk: ENTITY_TYPE.METADATA_APPL,
    gsi2sk: gsi2skAppl(metadataTypeCode, metadataValueCode),
    sk4: metadataValueCode,
    sk5: ENTITY_TYPE.METADATA_APPL,
  };
}

const INDEX_KEYS = ['pk', 'sk', 'entityType', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', 'sk1', 'sk2', 'sk3', 'sk4', 'sk5'];

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
