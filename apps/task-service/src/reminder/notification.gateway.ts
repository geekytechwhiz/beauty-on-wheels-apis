import { createLogger } from '@api-hub/observability';

const logger = createLogger({ service: 'task-service', redactPII: true });

/** Outbound reminder delivery request (notification service transport TBD). */
export interface SendReminderNotificationRequest {
  runtimeTaskInstanceId: string;
  patientId: string;
  orgId: string;
  channel: string;
  scheduledAt: number;
  correlationId?: string;
}

export interface NotificationGateway {
  sendReminder(request: SendReminderNotificationRequest): Promise<void>;
}

/**
 * Phase 3 stub — logs until notification service integration is defined.
 */
export class LogNotificationGateway implements NotificationGateway {
  async sendReminder(request: SendReminderNotificationRequest): Promise<void> {
    logger.info({
      event: 'reminder_notification_send_stub',
      runtimeTaskInstanceId: request.runtimeTaskInstanceId,
      patientId: request.patientId,
      orgId: request.orgId,
      channel: request.channel,
      scheduledAt: request.scheduledAt,
      correlationId: request.correlationId,
      message: 'Reminder notification send (stub — notification service not wired)',
    });
  }
}

let gateway: NotificationGateway | undefined;

export function getNotificationGateway(): NotificationGateway {
  if (!gateway) {
    gateway = new LogNotificationGateway();
  }
  return gateway;
}

export function setNotificationGatewayForTests(value: NotificationGateway | undefined): void {
  gateway = value;
}
