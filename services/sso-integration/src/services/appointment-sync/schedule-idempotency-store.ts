import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';

const IDEMPOTENCY_KEY_PREFIX = 'SCHEDULE#';

export interface IdempotencyRecord {
  status: 'success';
  scheduleId: string;
  createdAt: string;
}

function buildIdempotencyKey(tenantId: string, externalAppointmentId: string): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${tenantId}#${externalAppointmentId}`;
}

/**
 * DynamoDB-backed idempotency for schedule creation.
 * Key: tenantId#externalAppointmentId. Check before create; write after success.
 */
export async function getScheduleIdempotency(
  tenantId: string,
  externalAppointmentId: string,
): Promise<IdempotencyRecord | null> {
  const tableName = process.env.APPOINTMENT_IDEMPOTENCY_TABLE_NAME;
  if (!tableName) return null;

  const key = buildIdempotencyKey(tenantId, externalAppointmentId);
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key },
    }),
  );

  const item = result.Item;
  if (!item || item.status !== 'success') return null;
  return {
    status: 'success',
    scheduleId: String(item.scheduleId ?? ''),
    createdAt: String(item.createdAt ?? ''),
  };
}

export async function setScheduleIdempotency(
  tenantId: string,
  externalAppointmentId: string,
  scheduleId: string,
): Promise<void> {
  const tableName = process.env.APPOINTMENT_IDEMPOTENCY_TABLE_NAME;
  if (!tableName) return;

  const key = buildIdempotencyKey(tenantId, externalAppointmentId);
  const now = new Date().toISOString();
  await ddbDocClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: key,
        status: 'success',
        scheduleId,
        createdAt: now,
      },
    }),
  );
}
