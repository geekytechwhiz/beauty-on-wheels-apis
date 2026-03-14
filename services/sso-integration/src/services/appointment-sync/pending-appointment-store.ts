import {
  ConditionCheckFailedException,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { PendingAppointment } from '../../types';

const PENDING_PK_PREFIX = 'PENDING#';

export interface IPendingAppointmentStore {
  add(tenantId: string, pending: PendingAppointment): Promise<void>;
  getByPatient(
    tenantId: string,
    patientExternalId: string,
  ): Promise<PendingAppointment[]>;
  remove(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
  ): Promise<void>;
  updateRetryCount(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
    retryCount: number,
  ): Promise<void>;
}

function buildPk(tenantId: string, patientExternalId: string): string {
  return `${PENDING_PK_PREFIX}${tenantId}#${patientExternalId}`;
}

/**
 * DynamoDB-backed store for pending appointments.
 * Keys: pk = PENDING#tenantId#patientExternalId, sk = externalAppointmentId.
 * Idempotent add: conditional put so the same appointment is not stored twice.
 */
export class DynamoDbPendingAppointmentStore implements IPendingAppointmentStore {
  constructor(private readonly tableName: string) {}

  async add(tenantId: string, pending: PendingAppointment): Promise<void> {
    const pk = buildPk(tenantId, pending.patientExternalId);
    const sk = pending.externalAppointmentId;

    const item = {
      pk,
      sk,
      tenantId,
      patientExternalId: pending.patientExternalId,
      doctorExternalId: pending.doctorExternalId,
      externalAppointmentId: pending.externalAppointmentId,
      reason: pending.reason,
      timestamp: pending.timestamp,
      retryCount: pending.retryCount,
      appointment: pending.appointment,
      ttl: Math.floor(Date.now() / 1000) + 14 * 24 * 3600, // 14 days TTL
    };

    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(sk)',
        }),
      );
    } catch (err) {
      if (err instanceof ConditionCheckFailedException) {
        // Idempotent: already stored, treat as success
        return;
      }
      throw err;
    }
  }

  async getByPatient(
    tenantId: string,
    patientExternalId: string,
  ): Promise<PendingAppointment[]> {
    const pk = buildPk(tenantId, patientExternalId);

    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
      }),
    );

    const items = (result.Items ?? []) as Array<{
      appointment: PendingAppointment['appointment'];
      reason: PendingAppointment['reason'];
      timestamp: string;
      retryCount: number;
      patientExternalId: string;
      doctorExternalId: string;
      externalAppointmentId: string;
    }>;

    return items.map((row) => ({
      appointment: row.appointment,
      reason: row.reason,
      timestamp: row.timestamp,
      retryCount: row.retryCount,
      patientExternalId: row.patientExternalId,
      doctorExternalId: row.doctorExternalId,
      externalAppointmentId: row.externalAppointmentId,
    }));
  }

  async remove(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
  ): Promise<void> {
    const pk = buildPk(tenantId, patientExternalId);
    const sk = externalAppointmentId;

    await ddbDocClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      }),
    );
  }

  async updateRetryCount(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
    retryCount: number,
  ): Promise<void> {
    const pk = buildPk(tenantId, patientExternalId);
    const sk = externalAppointmentId;

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: 'SET retryCount = :retryCount',
        ExpressionAttributeValues: { ':retryCount': retryCount },
      }),
    );
  }
}

export function getPendingAppointmentStore(): IPendingAppointmentStore {
  const tableName = process.env.PENDING_APPOINTMENTS_TABLE_NAME;
  if (!tableName || tableName.trim() === '') {
    throw new Error('PENDING_APPOINTMENTS_TABLE_NAME is not set');
  }
  return new DynamoDbPendingAppointmentStore(tableName);
}
