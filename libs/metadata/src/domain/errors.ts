import { BaseError } from '@api-hub/utils';

import { STATUS } from '../constants';
import type { MetadataTypeRecord, Status } from '../models/types';

/** Stable public shape for HTTP mapping and tests (subclasses inherit this via {@link MetadataRegistryError}). */
export interface MetadataHttpErrorShape {
  statusCode: number;
  code: string;
  message: string;
  details?: { field?: string; message: string }[];
}

export class MetadataRegistryError extends BaseError implements MetadataHttpErrorShape {
  /** Re-declared so subclasses see {@link BaseError} fields when utils types resolve loosely. */
  declare readonly statusCode: number;
  declare readonly code: string;
  declare message: string;
  declare readonly details:
    | {
        code?: string;
        field?: string;
        message: string;
      }[]
    | undefined;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: { field?: string; message: string }[],
  ) {
    super(message, statusCode, code, details);
    this.name = 'MetadataRegistryError';
  }
}

export class ValidationError extends MetadataRegistryError {
  constructor(message: string, details?: { field?: string; message: string }[]) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends MetadataRegistryError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(message, 404, code);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends MetadataRegistryError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}

export const CHANGE_MANAGEMENT_STATUS_REQUIRED_MESSAGE =
  'Status changes must be performed through draft, impact-preview, and publish. Use ?action=draft|impact-preview|publish on PATCH /metadata/{entityType}/status or POST /metadata/{entityType}?action=...';

export const CHANGE_MANAGEMENT_DELETE_REQUIRED_MESSAGE =
  'Soft delete must be performed through draft, impact-preview, and publish.';

/** Thrown when legacy direct-write routes must use the governed draft → impact-preview → publish flow. */
export class ChangeManagementRequiredError extends ConflictError {
  constructor(message: string) {
    super(message, 'CHANGE_MANAGEMENT_REQUIRED');
    this.name = 'ChangeManagementRequiredError';
  }
}

const METADATA_TYPE_INACTIVE_MESSAGE = 'Cannot create value for inactive metadata type';

/** Thrown when creating, updating, or patching a metadata value while the parent type is not ACTIVE (latest version). */
export class MetadataTypeInactiveError extends MetadataRegistryError {
  constructor(metadataTypeCode: string, message: string = METADATA_TYPE_INACTIVE_MESSAGE) {
    super(message, 409, 'METADATA_TYPE_INACTIVE', [
      { field: 'metadataTypeCode', message: metadataTypeCode },
    ]);
    this.name = 'MetadataTypeInactiveError';
  }
}

/**
 * Enforces: value create/update/patch (new version) requires parent metadata type (latest) ACTIVE.
 * Read paths (get/list/search value) do not use this.
 */
export function assertMetadataTypeActiveForValueMutation(type: MetadataTypeRecord, metadataTypeCode: string): void {
  if (type.status !== STATUS.ACTIVE) {
    throw new MetadataTypeInactiveError(metadataTypeCode);
  }
}

/** POST upsert (field changes / new version) on latest type or value row when status is INACTIVE. */
export const INACTIVE_RECORD_MUTATION_MESSAGE =
  'Inactive records cannot be modified or versioned. Please activate the record before making changes.';

const inactiveRecordMutationDetails = [{ field: 'status', message: INACTIVE_RECORD_MUTATION_MESSAGE }];

/**
 * Blocks POST `/metadata/{entityType}` updates while the latest row stays INACTIVE.
 * Reactivation in the same request is allowed when normalized `status` on the body is explicitly `ACTIVE`
 * (any other fields may change in that version).
 */
export function assertPostUpsertAllowedForLatestStatus(
  latestStatus: Status,
  normalizedBodyStatus: Status | undefined,
): void {
  if (latestStatus !== STATUS.INACTIVE) {
    return;
  }
  if (normalizedBodyStatus === STATUS.ACTIVE) {
    return;
  }
  throw new ValidationError(INACTIVE_RECORD_MUTATION_MESSAGE, inactiveRecordMutationDetails);
}

/**
 * PATCH status only: when the latest row is INACTIVE, only a transition to ACTIVE is allowed (no other field
 * updates are possible on inactive rows; staying INACTIVE would version without purpose).
 */
export function assertPatchStatusAllowedForInactiveRecord(currentStatus: Status, requestedStatus: Status): void {
  if (currentStatus === STATUS.INACTIVE && requestedStatus !== STATUS.ACTIVE) {
    throw new ValidationError(INACTIVE_RECORD_MUTATION_MESSAGE, inactiveRecordMutationDetails);
  }
}
