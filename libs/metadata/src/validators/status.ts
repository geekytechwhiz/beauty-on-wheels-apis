import { STATUS } from '../constants';
import { ValidationError } from '../domain/errors';
import type { Status } from '../models/types';

/**
 * Top-level message used by PATCH `/.../status` rejections; preserved verbatim so handler error
 * shapes for activate/deactivate routes do not change as a result of consolidating the enum check.
 */
export const PATCH_STATUS_INVALID =
  'status must be Active or Inactive (other common casings are accepted)';

/** True when value is the literal string `ACTIVE` or `INACTIVE`. No coercion. */
export function isValidStatus(value: unknown): value is Status {
  return value === STATUS.ACTIVE || value === STATUS.INACTIVE;
}

/** Lifecycle status including terminal soft-delete (not valid on POST create/update body). */
export function isLifecycleStatus(value: unknown): value is Status {
  return value === STATUS.ACTIVE || value === STATUS.INACTIVE || value === STATUS.DELETED;
}

/**
 * Single source of truth for the `ACTIVE | INACTIVE` enum check.
 *
 * Call sites pass already-presence-checked / already-normalized values; this helper is purely the
 * `value === STATUS.ACTIVE || value === STATUS.INACTIVE` assertion. Message + detail are
 * configurable so existing route-specific copy (e.g. PATCH activate, value validator) is preserved.
 */
export function assertStatusEnum(
  value: unknown,
  opts: {
    field?: string;
    message?: string;
    detailMessage?: string;
  } = {},
): asserts value is Status {
  if (isValidStatus(value)) {
    return;
  }
  const field = opts.field ?? 'status';
  const message = opts.message ?? 'status must be ACTIVE or INACTIVE';
  const detailMessage = opts.detailMessage ?? 'Must be ACTIVE or INACTIVE';
  throw new ValidationError(message, [{ field, message: detailMessage }]);
}

/**
 * Parses a PATCH `/.../status` body status field. Trims + uppercases; rejects undefined / null /
 * unknown values with the activate-route copy. Used by the registry PATCH schema so status enum
 * validation runs before orchestration, mirroring the POST validation lifecycle.
 */
/**
 * Validates optional search/list filter status when set (allows DELETED for explicit admin queries).
 */
export function assertStatusFilterEnum(value: unknown): asserts value is Status {
  if (isLifecycleStatus(value)) {
    return;
  }
  throw new ValidationError('Invalid status filter', [
    { field: 'status', message: 'Must be ACTIVE, INACTIVE, or DELETED' },
  ]);
}

export function parsePatchStatusBody(raw: unknown): Status {
  if (raw === undefined || raw === null) {
    throw new ValidationError(PATCH_STATUS_INVALID, [{ field: 'status', message: 'Invalid' }]);
  }
  const status = String(raw).trim().toUpperCase();
  assertStatusEnum(status, { message: PATCH_STATUS_INVALID, detailMessage: 'Invalid' });
  return status;
}
