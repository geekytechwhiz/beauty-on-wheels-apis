import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { TASK_HISTORY_EVENT_TYPE, normalizeAssignedToTypeForWire, type SurfaceSection } from '../models/types/task-domain.types';
import {
  resolveCurrentStateForWire,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import { deriveActionCenterSurfaceSection } from '../utils/surface-section';
import { DEFAULT_ACTION_CENTER_TIMEZONE, nowEpochMs } from '../utils/task-time';

export type RuntimeTaskCardOptions = {
  timeZone?: string;
  nowMs?: number;
};

function resolveCardOptions(options?: RuntimeTaskCardOptions | number): RuntimeTaskCardOptions {
  if (typeof options === 'number') {
    return { nowMs: options };
  }
  return options ?? {};
}

export function toRuntimeTaskCard(
  r: TaskMetaDdbRecord,
  options?: RuntimeTaskCardOptions | number,
) {
  const { timeZone = DEFAULT_ACTION_CENTER_TIMEZONE, nowMs = nowEpochMs() } =
    resolveCardOptions(options);

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
    currentState: resolveCurrentStateForWire({
      persistedState: currentState,
      dueWindowStart: r.dueWindowStart,
      dueWindowEnd: r.dueWindowEnd,
      timeZone,
      nowMs,
    }),
  };
}

export function toActionCenterTaskCard(
  r: TaskMetaDdbRecord,
  timeZone: string,
  nowMs = nowEpochMs(),
  surfaceSection?: SurfaceSection,
) {
  const card = toRuntimeTaskCard(r, { timeZone, nowMs });
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

export type TaskHistoryWireContext = {
  dueWindowStart?: number;
  dueWindowEnd?: number;
  timeZone?: string;
};

function mapHistoryStateForWire(
  state: RuntimeTaskState | undefined,
  context: TaskHistoryWireContext,
  asOfMs: number,
): RuntimeTaskState | undefined {
  if (state == null) {
    return undefined;
  }
  return resolveCurrentStateForWire({
    persistedState: state,
    dueWindowStart: context.dueWindowStart,
    dueWindowEnd: context.dueWindowEnd,
    timeZone: context.timeZone ?? DEFAULT_ACTION_CENTER_TIMEZONE,
    nowMs: asOfMs,
  });
}

export function toTaskHistoryEntry(r: TaskHistDdbRecord, context?: TaskHistoryWireContext) {
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

  if (r.historyEventType === TASK_HISTORY_EVENT_TYPE.STATE_CHANGE && context) {
    return {
      ...rest,
      fromState: mapHistoryStateForWire(r.fromState, context, r.transitionAt),
      toState: mapHistoryStateForWire(r.toState, context, r.transitionAt),
    };
  }

  return rest;
}
