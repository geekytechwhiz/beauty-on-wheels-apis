import {
  ASSIGNED_TO_TYPE,
  isOrgStaffAssignedToType,
  isPatientAssignedToType,
  normalizeAssignedToTypeForWire,
  requiresAssigneeGsi,
  type AssignedToType,
} from '../models/types/task-domain.types';

const ASSIGNED_TO_TYPE_VALUES = Object.values(ASSIGNED_TO_TYPE);

export type AssignedToTypeInput = {
  assignedToType: AssignedToType;
  assignedToStaffId?: string;
  assignedToStaffDisplayName?: string;
};

function validationError(message: string): Error & { statusCode: number; code: string } {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 422;
  e.code = 'VALIDATION_ERROR';
  return e;
}

/**
 * When `assignedToType` is `patient`, assignee inbox fields are ignored (not persisted or indexed).
 * Non-patient types require assignee id + display name — see `validateAssignedToTypeInput`.
 */
export function normalizeAssignedToTypeInput<T extends AssignedToTypeInput>(input: T): T {
  const assignedToType = normalizeAssignedToTypeForWire(input.assignedToType);
  if (isPatientAssignedToType(assignedToType)) {
    const normalized = { ...input, assignedToType };
    delete normalized.assignedToStaffId;
    delete normalized.assignedToStaffDisplayName;
    return normalized;
  }
  return { ...input, assignedToType };
}

export function validateAssignedToTypeInput(input: AssignedToTypeInput): void {
  const assignedToType = normalizeAssignedToTypeForWire(input.assignedToType);
  if (!(ASSIGNED_TO_TYPE_VALUES as readonly string[]).includes(assignedToType)) {
    throw validationError(`assignedToType must be one of: ${ASSIGNED_TO_TYPE_VALUES.join(', ')}`);
  }

  if (
    requiresAssigneeGsi(assignedToType) &&
    (!input.assignedToStaffId?.trim() || !input.assignedToStaffDisplayName?.trim())
  ) {
    throw validationError(
      'assignedToStaffId and assignedToStaffDisplayName are required when assignedToType is not patient',
    );
  }
}

/** Normalize then validate — use at create boundaries before persistence. */
export function prepareAssignedToTypeInput<T extends AssignedToTypeInput>(input: T): T {
  const normalized = normalizeAssignedToTypeInput(input);
  validateAssignedToTypeInput(normalized);
  return normalized;
}

/** @deprecated Use {@link isOrgStaffAssignedToType} */
export function isStaffAssignedToType(assignedToType: AssignedToType): boolean {
  return isOrgStaffAssignedToType(assignedToType);
}
