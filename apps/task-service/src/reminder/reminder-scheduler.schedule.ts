import { nowEpochMs } from '@api-hub/task-core';
import type { ProcessReminderCallbackPayload } from './process-reminder.contract';
import type {
  CancelReminderJobRequest,
  RegisterReminderJobRequest,
} from './reminder-scheduler.types';

const SCHEDULE_NAME_PREFIX = 'task-reminder-';
const MAX_SCHEDULE_NAME_LENGTH = 64;
const MIN_FUTURE_SCHEDULE_MS = 60_000;

/** EventBridge Scheduler schedule names: `[0-9a-zA-Z-_.]+`, max 64 chars. */
export function buildReminderScheduleName(runtimeTaskInstanceId: string): string {
  const sanitized = runtimeTaskInstanceId.replace(/[^0-9a-zA-Z-_.]/g, '-');
  const name = `${SCHEDULE_NAME_PREFIX}${sanitized}`;
  return name.length <= MAX_SCHEDULE_NAME_LENGTH
    ? name
    : name.slice(0, MAX_SCHEDULE_NAME_LENGTH);
}

/** One-time schedule expression in UTC: `at(yyyy-mm-ddThh:mm:ss)`. */
export function toSchedulerAtExpression(epochMs: number): string {
  return `at(${new Date(epochMs).toISOString().slice(0, 19)})`;
}

export function isSchedulerEligibleFireTime(epochMs: number, nowMs = nowEpochMs()): boolean {
  return epochMs >= nowMs + MIN_FUTURE_SCHEDULE_MS;
}

export function buildProcessReminderTargetInput(
  request: RegisterReminderJobRequest,
  schedulerJobId: string,
): ProcessReminderCallbackPayload {
  return {
    runtimeTaskInstanceId: request.runtimeTaskInstanceId,
    patientId: request.patientId,
    orgId: request.orgId,
    scheduledAt: request.scheduledAt,
    channel: request.channel,
    schedulerJobId,
  };
}

export function buildCancelLogContext(request: CancelReminderJobRequest): Record<string, string | undefined> {
  return {
    runtimeTaskInstanceId: request.runtimeTaskInstanceId,
    patientId: request.patientId,
    orgId: request.orgId,
    reason: request.reason,
  };
}
