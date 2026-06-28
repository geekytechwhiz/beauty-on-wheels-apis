/** Outbound register request for EventBridge Scheduler. */
export interface RegisterReminderJobRequest {
  runtimeTaskInstanceId: string;
  patientId: string;
  orgId: string;
  scheduledAt: number;
  channel: string;
  correlationId?: string;
}

export type RegisterReminderResult =
  | { outcome: 'skipped'; reason: 'fireTimeTooSoon' }
  | { outcome: 'created' | 'updated'; schedulerJobId: string; scheduledAt: number };

/** Outbound cancel request for EventBridge Scheduler. */
export interface CancelReminderJobRequest {
  runtimeTaskInstanceId: string;
  patientId?: string;
  orgId?: string;
  reason: string;
}

export interface ReminderSchedulerGateway {
  register(request: RegisterReminderJobRequest): Promise<RegisterReminderResult>;
  cancel(request: CancelReminderJobRequest): Promise<void>;
}
