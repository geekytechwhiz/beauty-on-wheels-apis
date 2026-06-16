import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { normalizeAssignedToTypeForWire } from '../models/types/task-domain.types';
import { normalizeCurrentStateForWire } from '../models/types/runtime-task-state.type';
import { deriveActionCenterSurfaceSection } from '../utils/surface-section';

export function toRuntimeTaskCard(r: TaskMetaDdbRecord, _nowMs = Date.now()) {
  const {
    pk: _pk,
    sk: _sk,
    entityType: _entityType,
    lsi1Sk: _lsi1Sk,
    gsi1Pk: _gsi1Pk,
    gsi1Sk: _gsi1Sk,
    idempotencyKey: _idempotencyKey,
    generationHash: _generationHash,
    version: _version,
    currentState,
    assignedToType,
    ...rest
  } = r;

  return {
    ...rest,
    assignedToType: normalizeAssignedToTypeForWire(assignedToType),
    currentState: normalizeCurrentStateForWire(currentState),
  };
}

export function toActionCenterTaskCard(
  r: TaskMetaDdbRecord,
  timeZone: string,
  nowMs = Date.now(),
  surfaceSection?: SurfaceSection,
) {
  const card = toRuntimeTaskCard(r, nowMs);
  const derived =
    surfaceSection ??
    deriveActionCenterSurfaceSection(
      {
        currentState: r.currentState,
        dueWindowStart: r.dueWindowStart,
        dueWindowEnd: r.dueWindowEnd,
        displayAsChecklistItem: r.displayAsChecklistItem,
      },
      timeZone,
      nowMs,
    );
  return {
    ...card,
    surfaceSection: derived,
  };
}

export function toTaskHistoryEntry(r: TaskHistDdbRecord) {
  const {
    pk: _pk,
    sk: _sk,
    entityType: _entityType,
    orgId: _orgId,
    patientId: _patientId,
    runtimeTaskInstanceId: _runtimeTaskInstanceId,
    ...rest
  } = r;
  return rest;
}
