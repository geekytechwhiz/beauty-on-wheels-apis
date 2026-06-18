/** Outbound register request for EventBridge Scheduler (phase 2). */
export interface RegisterReminderJobRequest {
  runtimeTaskInstanceId: string;
  patientId: string;
  orgId: string;
  scheduledAt: number;
  channel: string;
  correlationId?: string;
}

/** Outbound cancel request for EventBridge Scheduler (phase 2). */
export interface CancelReminderJobRequest {
  runtimeTaskInstanceId: string;
  patientId?: string;
  orgId?: string;
  reason: string;
}

export interface ReminderSchedulerGateway {
  register(request: RegisterReminderJobRequest): Promise<void>;
  cancel(request: CancelReminderJobRequest): Promise<void>;
}
