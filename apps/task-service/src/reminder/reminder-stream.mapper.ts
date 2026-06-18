import type {
  CancelReminderJobRequest,
  RegisterReminderJobRequest,
} from './reminder-scheduler.types';

/** META stream image fields used by register/cancel processors. */
export type TaskMetaStreamImage = {
  entityType: string;
  runtimeTaskInstanceId: string;
  orgId: string;
  patientId: string;
  reminderEnabled?: boolean;
  reminderSettings?: { channels?: string[] };
  currentState?: string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
};

export function scheduledReminderAtFromMeta(meta: TaskMetaStreamImage): number {
  return meta.dueWindowEnd ?? meta.dueWindowStart!;
}

export function primaryReminderChannel(meta: TaskMetaStreamImage): string {
  return meta.reminderSettings?.channels?.[0]!;
}

export function deriveCancelReason(meta: TaskMetaStreamImage): string {
  if (meta.reminderEnabled === false) {
    return 'remindersDisabled';
  }
  const state = meta.currentState;
  if (state) {
    return `taskTerminalState:${state}`;
  }
  return 'unknown';
}

/** Stream filters gate eligibility; processor maps META → scheduler request. */
export function mapMetaToRegisterRequest(
  meta: TaskMetaStreamImage,
  correlationId?: string,
): RegisterReminderJobRequest {
  return {
    runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    patientId: meta.patientId,
    orgId: meta.orgId,
    scheduledAt: scheduledReminderAtFromMeta(meta),
    channel: primaryReminderChannel(meta),
    correlationId,
  };
}

export function mapMetaToCancelRequest(meta: TaskMetaStreamImage): CancelReminderJobRequest {
  return {
    runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    patientId: meta.patientId,
    orgId: meta.orgId,
    reason: deriveCancelReason(meta),
  };
}
