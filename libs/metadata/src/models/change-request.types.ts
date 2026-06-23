export const CHANGE_REQUEST_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
} as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUS)[keyof typeof CHANGE_REQUEST_STATUS];

export const CHANGE_REQUEST_OPERATION = {
  ADD: 'Add',
  UPDATE: 'Update',
} as const;

export type ChangeRequestOperation = (typeof CHANGE_REQUEST_OPERATION)[keyof typeof CHANGE_REQUEST_OPERATION];

export type ChangeRequestEntityType = 'type' | 'value';

/** Persisted change request draft (DynamoDB CHANGE_REQUEST# / META). */
export interface ChangeRequestRecord {
  changeRequestId: string;
  status: ChangeRequestStatus;
  entityType: ChangeRequestEntityType;
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string;
  baseVersion: number | null;
  proposedPayload: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
  lastModifiedAt: string;
  lastModifiedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  /** Monotonic registry-wide revision assigned at publish (addendum §6). */
  changeRevision?: number;
  publishedAt?: string;
}

/** API response for POST ?action=draft. */
export interface ChangeRequestDraftResponse {
  changeRequestId: string;
  status: ChangeRequestStatus;
  entityType: ChangeRequestEntityType;
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string | null;
  baseVersion: number | null;
  createdAt: string;
  createdBy?: string;
  lastModifiedAt: string;
}

export function toChangeRequestDraftResponse(record: ChangeRequestRecord): ChangeRequestDraftResponse {
  return {
    changeRequestId: record.changeRequestId,
    status: record.status,
    entityType: record.entityType,
    operation: record.operation,
    metadataTypeCode: record.metadataTypeCode,
    metadataValueCode: record.metadataValueCode ?? null,
    baseVersion: record.baseVersion,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    lastModifiedAt: record.lastModifiedAt,
  };
}

/** API response for `GET /metadata/change-requests/{changeRequestId}` — DRAFT only, includes form payload. */
export interface ChangeRequestDraftDetailResponse {
  changeRequestId: string;
  status: typeof CHANGE_REQUEST_STATUS.DRAFT;
  entityType: ChangeRequestEntityType;
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string | null;
  baseVersion: number | null;
  proposedPayload: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
  lastModifiedAt: string;
  lastModifiedBy?: string;
}

export function toChangeRequestDraftDetailResponse(
  record: ChangeRequestRecord,
): ChangeRequestDraftDetailResponse {
  return {
    changeRequestId: record.changeRequestId,
    status: CHANGE_REQUEST_STATUS.DRAFT,
    entityType: record.entityType,
    operation: record.operation,
    metadataTypeCode: record.metadataTypeCode,
    metadataValueCode: record.metadataValueCode ?? null,
    baseVersion: record.baseVersion,
    proposedPayload: record.proposedPayload,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    lastModifiedAt: record.lastModifiedAt,
    lastModifiedBy: record.lastModifiedBy,
  };
}

/** API response for POST `?action=cancel`. */
export interface ChangeRequestCancelledResponse {
  changeRequestId: string;
  status: typeof CHANGE_REQUEST_STATUS.CANCELLED;
  entityType: ChangeRequestEntityType;
  metadataTypeCode: string;
  metadataValueCode?: string | null;
  cancelledAt: string;
}

export function toChangeRequestCancelledResponse(
  record: ChangeRequestRecord,
): ChangeRequestCancelledResponse {
  return {
    changeRequestId: record.changeRequestId,
    status: CHANGE_REQUEST_STATUS.CANCELLED,
    entityType: record.entityType,
    metadataTypeCode: record.metadataTypeCode,
    metadataValueCode: record.metadataValueCode ?? null,
    cancelledAt: record.cancelledAt ?? record.lastModifiedAt,
  };
}
