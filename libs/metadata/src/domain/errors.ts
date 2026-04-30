import { BaseError } from '@api-hub/utils';

import { STATUS } from '../constants';
import type { MetadataTypeRecord } from '../models/types';

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
