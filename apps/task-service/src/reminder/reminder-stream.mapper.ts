import {
  isReminderRegistrationEligible,
  type RuntimeTaskState,
} from '@api-hub/task-core';

import type {
  CancelReminderJobRequest,
  RegisterReminderJobRequest,
} from './reminder-scheduler.types';

/** META stream image fields used by register/cancel handlers. */
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

export function scheduledReminderAtFromMeta(meta: TaskMetaStreamImage): number | undefined {
  return meta.dueWindowEnd ?? meta.dueWindowStart;
}

export function primaryReminderChannel(meta: TaskMetaStreamImage): string | undefined {
  return meta.reminderSettings?.channels?.[0];
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

export function mapMetaToRegisterRequest(
  meta: TaskMetaStreamImage,
  correlationId?: string,
): RegisterReminderJobRequest | undefined {
  if (meta.reminderEnabled !== true) {
    return undefined;
  }

  const currentState = meta.currentState as RuntimeTaskState | undefined;
  if (!currentState || !isReminderRegistrationEligible(currentState)) {
    return undefined;
  }

  const scheduledAt = scheduledReminderAtFromMeta(meta);
  const channel = primaryReminderChannel(meta);
  if (scheduledAt == null || !channel) {
    return undefined;
  }

  return {
    runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    patientId: meta.patientId,
    orgId: meta.orgId,
    scheduledAt,
    channel,
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
