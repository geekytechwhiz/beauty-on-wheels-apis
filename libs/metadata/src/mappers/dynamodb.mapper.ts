import { ENTITY_TYPE } from '../domain/constants';
import type { MetadataType, MetadataValue } from '../domain/types';
import { gsi1pkRegistryTypes, gsi1skMetadataType, pkMetadataType, skAppl, skTypeMetadata, skValue } from '../repository/keys';

export type MetadataTypeItem = MetadataType & {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_TYPE;
  gsi1pk: string;
  gsi1sk: string;
};

export type MetadataValueItem = MetadataValue & {
  pk: string;
  sk: string;
  entityType: typeof ENTITY_TYPE.METADATA_VALUE;
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
  };
}

export function toMetadataValueItem(value: MetadataValue): MetadataValueItem {
  return {
    ...value,
    pk: pkMetadataType(value.metadataTypeCode),
    sk: skValue(value.metadataValueCode),
    entityType: ENTITY_TYPE.METADATA_VALUE,
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
  };
}

export function fromMetadataTypeItem(item: Record<string, unknown>): MetadataType {
  const rest = { ...item };
  delete rest.pk;
  delete rest.sk;
  delete rest.entityType;
  delete rest.gsi1pk;
  delete rest.gsi1sk;
  return rest as unknown as MetadataType;
}

export function fromMetadataValueItem(item: Record<string, unknown>): MetadataValue {
  const rest = { ...item };
  delete rest.pk;
  delete rest.sk;
  delete rest.entityType;
  return rest as unknown as MetadataValue;
}
