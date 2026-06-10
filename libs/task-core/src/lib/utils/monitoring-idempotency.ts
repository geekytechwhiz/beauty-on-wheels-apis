import { sha256Hex } from '@api-hub/utils';

import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';

import { resolveDueWindowStartAtCreate } from './task-time';

export function buildMonitoringIdempotencyKey(input: CreateMonitoringActionRequest): string {
  return [
    input.organizationId,
    input.patientId,
    input.monitoringInstanceId,
    input.taskBehaviorCode,
    String(input.dueWindowStart),
    String(input.dueWindowEnd),
  ].join('|');
}

export function buildDeterministicRuntimeTaskInstanceId(idempotencyKey: string): string {
  const hash = sha256Hex(idempotencyKey);
  return `rtask-${hash.slice(0, 32)}`;
}

export function buildGenerationHash(idempotencyKey: string): string {
  return sha256Hex(idempotencyKey);
}

export function buildCarePlanTaskIdempotencyKey(input: CreateCarePlanTaskRequest): string {
  const resolvedStart = resolveDueWindowStartAtCreate(input.dueWindowStart, input.dueWindowEnd);
  return [
    input.organizationId,
    input.patientId,
    input.carePlanInstanceId,
    input.carePlanTaskLinkageId,
    resolvedStart != null ? String(resolvedStart) : '',
    input.dueWindowEnd != null ? String(input.dueWindowEnd) : '',
  ].join('|');
}

export function buildCarePlanTaskKeys(input: CreateCarePlanTaskRequest): {
  idempotencyKey: string;
  runtimeTaskInstanceId: string;
  generationHash: string;
} {
  const idempotencyKey = buildCarePlanTaskIdempotencyKey(input);
  return {
    idempotencyKey,
    runtimeTaskInstanceId: buildDeterministicRuntimeTaskInstanceId(idempotencyKey),
    generationHash: buildGenerationHash(idempotencyKey),
  };
}
