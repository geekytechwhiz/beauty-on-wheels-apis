import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { deriveSurfaceSection } from '../utils/surface-section';

export function toRuntimeTaskCard(r: TaskMetaDdbRecord, nowMs = Date.now()) {
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
    ...rest
  } = r;

  return {
    ...rest,
    surfaceSection: deriveSurfaceSection(
      {
        currentState: r.currentState,
        dueWindowStart: r.dueWindowStart,
        displayToPatient: r.displayToPatient,
      },
      nowMs,
    ),
  };
}
