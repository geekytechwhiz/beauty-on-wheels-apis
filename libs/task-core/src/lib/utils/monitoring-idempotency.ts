import { sha256Hex } from '@api-hub/utils';

import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';

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
