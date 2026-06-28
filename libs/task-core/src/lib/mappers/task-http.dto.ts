import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { normalizeAssignedToTypeForWire, type SurfaceSection } from '../models/types/task-domain.types';
import { normalizeCurrentStateForWire } from '../models/types/runtime-task-state.type';
import { deriveActionCenterSurfaceSection } from '../utils/surface-section';
import { nowEpochMs } from '../utils/task-time';

export function toRuntimeTaskCard(r: TaskMetaDdbRecord, _nowMs = nowEpochMs()) {
  /* eslint-disable @typescript-eslint/no-unused-vars -- Dynamo envelope keys omitted via rest */
  const {
    pk,
    sk,
    entityType,
    sk1,
    gsi1pk,
    gsi1sk,
    idempotencyKey,
    generationHash,
    version,
    currentState,
    assignedToType,
    ...rest
  } = r;
  /* eslint-enable @typescript-eslint/no-unused-vars */

  return {
    ...rest,
    assignedToType: normalizeAssignedToTypeForWire(assignedToType),
    currentState: normalizeCurrentStateForWire(currentState),
  };
}

export function toActionCenterTaskCard(
  r: TaskMetaDdbRecord,
  timeZone: string,
  nowMs = nowEpochMs(),
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
  /* eslint-disable @typescript-eslint/no-unused-vars -- Dynamo envelope and scope keys omitted via rest */
  const {
    pk,
    sk,
    entityType,
    orgId,
    patientId,
    runtimeTaskInstanceId,
    ...rest
  } = r;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest;
}
