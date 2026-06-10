import type { ImpactPreviewResponse } from './impact-preview.types';
import type { ChangeRequestOperation } from './change-request.types';
import type { MetadataTypeRecord, MetadataValueRecord } from './types';
import type { MetadataValueApiModel } from '../mappers/metadata-request.mapper';
import type { PublishVersionStrategy } from '../publish/publish-version.strategy';

export interface MetadataPublishResult {
  changeRequestId: string;
  changeRevision: number;
  entityType: 'type' | 'value';
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode: string | null;
  publishStrategy: PublishVersionStrategy;
  version: number;
  impactSummary: ImpactPreviewResponse['impactSummary'];
  record: MetadataTypeRecord | MetadataValueRecord;
}

/** POST `?action=publish` response — no ruleId or catalog exposure. */
export interface MetadataPublishResponse {
  changeRequestId: string;
  changeRevision: number;
  entityType: 'type' | 'value';
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode: string | null;
  publishStrategy: PublishVersionStrategy;
  version: number;
  impactSummary: ImpactPreviewResponse['impactSummary'];
  published: MetadataTypeRecord | MetadataValueApiModel;
}
