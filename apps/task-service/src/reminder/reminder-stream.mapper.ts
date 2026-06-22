import {
  resolveReminderScheduleAt,
  type PatientQuietWindow,
  type ReminderScheduleAnchor,
} from '@api-hub/task-core';

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
  reminderSettings?: {
    channels?: string[];
    quietHoursRespected?: boolean;
    scheduleAnchor?: ReminderScheduleAnchor;
    offsetMs?: number;
    quietHoursBufferMs?: number;
    [key: string]: unknown;
  };
  currentState?: string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
};

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

/**
 * Maps META stream image to a register request for EventBridge Scheduler.
 * Returns `null` when no due-window anchor can be resolved or no channel is configured.
 */
export function mapMetaToRegisterRequest(
  meta: TaskMetaStreamImage,
  correlationId?: string,
  quietWindow?: PatientQuietWindow | null,
): RegisterReminderJobRequest | null {
  const channel = primaryReminderChannel(meta);
  if (!channel) {
    return null;
  }

  const resolved = resolveReminderScheduleAt(
    meta.dueWindowStart,
    meta.dueWindowEnd,
    meta.reminderSettings,
    quietWindow ?? null,
  );

  if (!resolved) {
    return null;
  }

  return {
    runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    patientId: meta.patientId,
    orgId: meta.orgId,
    scheduledAt: resolved.scheduledAt,
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
