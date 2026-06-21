import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  RUNTIME_TASK_METADATA_FIELDS,
  type RuntimeTaskMetadataDiff,
  type RuntimeTaskMetadataField,
  type RuntimeTaskMetadataPatch,
} from '../models/api/update-runtime-task.request';
import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

function metadataValidationError(
  message: string,
  statusCode: number,
  code: string,
): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const READINESS_BLOCKING_TERMINAL_STATES = new Set<RuntimeTaskState>([
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
]);

function fieldValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a == null && b == null) {
    return true;
  }
  return false;
}

function readMetaField(meta: TaskMetaDdbRecord, field: RuntimeTaskMetadataField): unknown {
  return meta[field as keyof TaskMetaDdbRecord];
}

export function computeRuntimeTaskMetadataDiff(
  meta: TaskMetaDdbRecord,
  patch: RuntimeTaskMetadataPatch,
): RuntimeTaskMetadataDiff | null {
  const changedFields: RuntimeTaskMetadataField[] = [];
  const previousValues: Partial<Record<RuntimeTaskMetadataField, unknown>> = {};
  const newValues: Partial<Record<RuntimeTaskMetadataField, unknown>> = {};
  const metaUpdates: Partial<TaskMetaDdbRecord> = {};
  const lookupUpdates: Partial<{ patientDisplayName: string }> = {};

  for (const field of RUNTIME_TASK_METADATA_FIELDS) {
    if (!(field in patch)) {
      continue;
    }
    const nextValue = patch[field];
    const previousValue = readMetaField(meta, field);
    if (fieldValueEqual(previousValue, nextValue)) {
      continue;
    }

    changedFields.push(field);
    previousValues[field] = previousValue;
    newValues[field] = nextValue;
    (metaUpdates as Record<string, unknown>)[field] = nextValue;
    if (field === 'patientDisplayName' && typeof nextValue === 'string') {
      lookupUpdates.patientDisplayName = nextValue;
    }
  }

  if (changedFields.length === 0) {
    return null;
  }

  return {
    changedFields,
    previousValues,
    newValues,
    metaUpdates,
    lookupUpdates,
  };
}

export function assertRequiredForStageCompletionAllowed(
  currentState: RuntimeTaskState,
  patch: RuntimeTaskMetadataPatch,
): void {
  if (
    patch.requiredForStageCompletion === true &&
    READINESS_BLOCKING_TERMINAL_STATES.has(currentState)
  ) {
    throw metadataValidationError(
      'requiredForStageCompletion cannot be set to true for a task in a terminal state',
      422,
      'INVALID_METADATA_FOR_STATE',
    );
  }
}
