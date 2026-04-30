import type { CreateMetadataRelationInput, MetadataRelationRecord } from '../models/relation-types';

export interface ListRelationsByFromOptions {
  /** `begins_with` on sort key, e.g. `CHILD#` or `CHILD#State#` */
  skBeginsWith?: string;
}

export interface IRelationRepository {
  createRelation(input: CreateMetadataRelationInput, actor?: string): Promise<MetadataRelationRecord>;
  getRelationByKey(pk: string, sk: string): Promise<MetadataRelationRecord | null>;
  listRelationsByFrom(
    fromMetadataTypeCode: string,
    fromMetadataValueCode: string,
    options?: ListRelationsByFromOptions,
  ): Promise<MetadataRelationRecord[]>;
  inactivateRelation(
    pk: string,
    sk: string,
    actor?: string,
  ): Promise<MetadataRelationRecord>;
}
