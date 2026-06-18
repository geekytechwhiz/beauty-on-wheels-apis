import { createLogger } from '@api-hub/observability';

import type {
  CancelReminderJobRequest,
  RegisterReminderJobRequest,
  ReminderSchedulerGateway,
} from './reminder-scheduler.types';

const logger = createLogger({ service: 'task-service', redactPII: true });

/**
 * Phase 1: log-only stub. Replace with EventBridge Scheduler API calls in phase 2.
 */
export class LogReminderSchedulerGateway implements ReminderSchedulerGateway {
  async register(request: RegisterReminderJobRequest): Promise<void> {
    logger.info({
      event: 'reminder_scheduler_register_stub',
      runtimeTaskInstanceId: request.runtimeTaskInstanceId,
      patientId: request.patientId,
      orgId: request.orgId,
      scheduledAt: request.scheduledAt,
      channel: request.channel,
      correlationId: request.correlationId,
      message: 'Reminder schedule register (stub — EventBridge Scheduler not wired)',
    });
  }

  async cancel(request: CancelReminderJobRequest): Promise<void> {
    logger.info({
      event: 'reminder_scheduler_cancel_stub',
      runtimeTaskInstanceId: request.runtimeTaskInstanceId,
      patientId: request.patientId,
      orgId: request.orgId,
      reason: request.reason,
      message: 'Reminder schedule cancel (stub — EventBridge Scheduler not wired)',
    });
  }
}

let gateway: ReminderSchedulerGateway | undefined;

export function getReminderSchedulerGateway(): ReminderSchedulerGateway {
  if (!gateway) {
    gateway = new LogReminderSchedulerGateway();
  }
  return gateway;
}

export function setReminderSchedulerGatewayForTests(
  value: ReminderSchedulerGateway | undefined,
): void {
  gateway = value;
}
