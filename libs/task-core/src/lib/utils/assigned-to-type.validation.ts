import {
  ASSIGNED_TO_TYPE,
  isKnownAssignedToType,
  isPatientAssignedToType,
  requiresAssigneeGsi,
  type AssignedToType,
} from '../models/types/task-domain.types';

export type AssignedToTypeInput = {
  assignedToType: AssignedToType | string;
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
 * When `assignedToType` is patient, assignee inbox fields are ignored (not persisted or indexed).
 * Assignee type value is stored verbatim — not rewritten to a canonical form.
 */
export function normalizeAssignedToTypeInput<T extends AssignedToTypeInput>(input: T): T {
  if (isPatientAssignedToType(input.assignedToType)) {
    const normalized = { ...input };
    delete normalized.assignedToStaffId;
    delete normalized.assignedToStaffDisplayName;
    return normalized;
  }
  return { ...input };
}

export function validateAssignedToTypeInput(input: AssignedToTypeInput): void {
  if (!isKnownAssignedToType(input.assignedToType)) {
    throw validationError(
      `assignedToType must be one of: ${Object.values(ASSIGNED_TO_TYPE).join(', ')}`,
    );
  }

  if (
    requiresAssigneeGsi(input.assignedToType) &&
    (!input.assignedToStaffId?.trim() || !input.assignedToStaffDisplayName?.trim())
  ) {
    throw validationError(
      'assignedToStaffId and assignedToStaffDisplayName are required when assignedToType is not patient',
    );
  }
}

/** Strip patient assignee fields then validate — use at create boundaries before persistence. */
export function prepareAssignedToTypeInput<T extends AssignedToTypeInput>(input: T): T {
  const normalized = normalizeAssignedToTypeInput(input);
  validateAssignedToTypeInput(normalized);
  return normalized;
}
