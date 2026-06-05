import type {
  CreateMetadataRelationInput,
  MetadataRelationRecord,
  RelationStatus,
} from '../models/relation-types';

export interface ListRelationsByFromOptions {
  /** `begins_with` on sort key, e.g. `CHILD#` or `CHILD#State#` */
  skBeginsWith?: string;
  /** Default ACTIVE only; use ALL for sync/admin when inactive rows must be visible. */
  status?: 'ACTIVE' | 'ALL';
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
  reactivateRelation(pk: string, sk: string, actor?: string): Promise<MetadataRelationRecord>;
  /** Set relation lifecycle status; no-op when already at `status`. */
  updateRelationStatus(
    pk: string,
    sk: string,
    status: RelationStatus,
    actor?: string,
  ): Promise<MetadataRelationRecord>;
}
