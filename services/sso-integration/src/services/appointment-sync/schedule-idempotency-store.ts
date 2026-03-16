import { getScheduleServiceClient } from '../../clients/schedule-service.client';
import { SSORequestContext } from '../../types/common/context.types';

export interface IdempotencyRecord {
  status: 'success';
  scheduleId: string;
  createdAt: string;
}

/**
 * Idempotency for schedule creation is owned by the Scheduler service.
 * These helpers call Scheduler APIs via ScheduleServiceClient.
 */
export async function getScheduleIdempotency(
  tenantId: string,
  externalAppointmentId: string,
  context: SSORequestContext,
): Promise<IdempotencyRecord | null> {
  const client = getScheduleServiceClient();
  const result = await client.checkAppointmentIdempotency(
    tenantId,
    externalAppointmentId,
    context,
  );
  if (!result.alreadyProcessed || !result.scheduleId) {
    return null;
  }
  return {
    status: 'success',
    scheduleId: result.scheduleId,
    createdAt: new Date().toISOString(),
  };
}

export async function setScheduleIdempotency(
  tenantId: string,
  externalAppointmentId: string,
  scheduleId: string,
  context: SSORequestContext,
): Promise<void> {
  const client = getScheduleServiceClient();
  await client.markAppointmentProcessed(
    tenantId,
    externalAppointmentId,
    scheduleId,
    context,
  );
}
