import type {
  CancelReminderJobRequest,
  RegisterReminderJobRequest,
  ReminderSchedulerGateway,
} from './reminder-scheduler.types';

/**
 * Phase 1: no-op stub. Replace with EventBridge Scheduler API calls in phase 2.
 */
export class LogReminderSchedulerGateway implements ReminderSchedulerGateway {
  async register(_request: RegisterReminderJobRequest): Promise<void> {
    // EventBridge Scheduler CreateSchedule — phase 2
  }

  async cancel(_request: CancelReminderJobRequest): Promise<void> {
    // EventBridge Scheduler DeleteSchedule — phase 2
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
