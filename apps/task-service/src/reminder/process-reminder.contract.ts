/**
 * Contract for EventBridge Scheduler → processReminder Lambda invocation.
 * Scheduler target input should match this shape (camelCase on the wire).
 */
export const PROCESS_REMINDER_CALLBACK_VERSION = '1.0.0';

export interface ProcessReminderCallbackPayload {
  runtimeTaskInstanceId: string;
  patientId: string;
  orgId: string;
  scheduledAt: number;
  channel: string;
  schedulerJobId?: string;
}
