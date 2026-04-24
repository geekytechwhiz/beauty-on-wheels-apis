import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ulid } from 'ulid';
import type { AlertRecord, AlertState, CreateAlertInput, UpdateAlertInput } from './alert.types';

const client = new DynamoDBClient({});

const TABLE = process.env.ALERT_TABLE ?? '';

function priorityPad(p: number): string {
  return String(1000 - Math.min(999, Math.max(0, Math.floor(p)))).padStart(4, '0');
}

export class AlertRepository {
  async getByEventId(inputEventId: string): Promise<AlertRecord | null> {
    const res = await client.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: marshall({ pk: `EVENT#${inputEventId}`, sk: 'ALERT' }),
      }),
    );
    if (!res.Item) return null;
    const row = unmarshall(res.Item) as { alertId: string };
    return this.getAlertById(row.alertId);
  }

  async getAlertById(alertId: string): Promise<AlertRecord | null> {
    const res = await client.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: marshall({ pk: `ALERT#${alertId}`, sk: 'META' }),
      }),
    );
    if (!res.Item) return null;
    return unmarshall(res.Item) as AlertRecord;
  }

  async createAlert(input: CreateAlertInput): Promise<AlertRecord> {
    const alertId = ulid();
    const triggerTimestamp = input.triggerTimestamp ?? new Date().toISOString();
    const now = new Date().toISOString();
    const state: AlertState = 'OPEN';

    const gsi1pk = `PATIENT#${input.patientId}`;
    const gsi1sk = `${triggerTimestamp}#${alertId}`;
    const gsi2pk = `ORG#${input.organizationId}`;
    const gsi2sk = `${state}#${priorityPad(input.priority)}#${triggerTimestamp}#${alertId}`;
    const record: AlertRecord = {
      pk: `ALERT#${alertId}`,
      sk: 'META',
      alertId,
      patientId: input.patientId,
      organizationId: input.organizationId,
      inputEventId: input.inputEventId,
      inputType: input.inputType,
      alertState: state,
      priority: input.priority,
      triggerTimestamp,
      slaBreachIndicator: false,
      groupingKey: input.groupingKey,
      alertPolicyTemplateVersionId: input.alertPolicyTemplateVersionId,
      title: input.title,
      detail: input.detail,
      gsi1pk,
      gsi1sk,
      gsi2pk,
      gsi2sk,
      createdAt: now,
      updatedAt: now,
    };

    await client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: marshall(record),
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: marshall({
                pk: `EVENT#${input.inputEventId}`,
                sk: 'ALERT',
                alertId,
                createdAt: now,
              }),
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    );

    return record;
  }

  async queryPatientAlerts(
    patientId: string,
    opts: { openOnly?: boolean; inputType?: string; limit?: number },
  ): Promise<AlertRecord[]> {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :p',
        ExpressionAttributeValues: marshall({
          ':p': `PATIENT#${patientId}`,
        }),
        ScanIndexForward: false,
        Limit: opts.limit ?? 50,
      }),
    );
    let items = (res.Items ?? []).map((i) => unmarshall(i) as AlertRecord);
    if (opts.openOnly) {
      items = items.filter((a) => a.alertState !== 'CLOSED');
    }
    if (opts.inputType) {
      items = items.filter((a) => a.inputType === opts.inputType);
    }
    return items;
  }

  async queryOrgAlerts(
    organizationId: string,
    opts: { state?: AlertState; limit?: number; unassignedOnly?: boolean },
  ): Promise<AlertRecord[]> {
    const state = opts.state ?? 'OPEN';
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'gsi2pk = :o AND begins_with(gsi2sk, :s)',
        ExpressionAttributeValues: marshall({
          ':o': `ORG#${organizationId}`,
          ':s': `${state}#`,
        }),
        ScanIndexForward: false,
        Limit: opts.limit ?? 50,
      }),
    );
    let items = (res.Items ?? []).map((i) => unmarshall(i) as AlertRecord);
    if (opts.unassignedOnly) {
      items = items.filter((a) => !a.assignedToUserId);
    }
    return items;
  }

  async queryUserAlerts(
    userId: string,
    opts: { state?: AlertState; limit?: number },
  ): Promise<AlertRecord[]> {
    const base = {
      TableName: TABLE,
      IndexName: 'GSI3',
      ExpressionAttributeValues: marshall({
        ':u': `USER#${userId}`,
        ...(opts.state ? { ':st': `${opts.state}#` } : {}),
      }),
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    } as const;

    const res = await client.send(
      new QueryCommand({
        ...base,
        KeyConditionExpression: opts.state
          ? 'gsi3pk = :u AND begins_with(gsi3sk, :st)'
          : 'gsi3pk = :u',
      }),
    );
    return (res.Items ?? []).map((i) => unmarshall(i) as AlertRecord);
  }

  async updateAlert(alertId: string, patch: UpdateAlertInput): Promise<AlertRecord | null> {
    const existing = await this.getAlertById(alertId);
    if (!existing) return null;

    const nextState = patch.alertState ?? existing.alertState;
    const nextAssign =
      patch.assignedToUserId === undefined
        ? existing.assignedToUserId
        : patch.assignedToUserId === null
          ? undefined
          : patch.assignedToUserId;
    const nextSla = patch.slaBreachIndicator ?? existing.slaBreachIndicator;
    const now = new Date().toISOString();

    const gsi2sk = `${nextState}#${priorityPad(existing.priority)}#${existing.triggerTimestamp}#${alertId}`;

    if (nextAssign) {
      const gsi3pk = `USER#${nextAssign}`;
      const gsi3sk = `${nextState}#${existing.triggerTimestamp}#${alertId}`;
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: marshall({ pk: existing.pk, sk: existing.sk }),
          UpdateExpression:
            'SET alertState = :st, updatedAt = :u, gsi2sk = :g2s, slaBreachIndicator = :sla, assignedToUserId = :a, gsi3pk = :g3p, gsi3sk = :g3s',
          ExpressionAttributeValues: marshall({
            ':st': nextState,
            ':u': now,
            ':g2s': gsi2sk,
            ':sla': nextSla,
            ':a': nextAssign,
            ':g3p': gsi3pk,
            ':g3s': gsi3sk,
          }),
        }),
      );
    } else {
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: marshall({ pk: existing.pk, sk: existing.sk }),
          UpdateExpression:
            'SET alertState = :st, updatedAt = :u, gsi2sk = :g2s, slaBreachIndicator = :sla REMOVE assignedToUserId, gsi3pk, gsi3sk',
          ExpressionAttributeValues: marshall({
            ':st': nextState,
            ':u': now,
            ':g2s': gsi2sk,
            ':sla': nextSla,
          }),
        }),
      );
    }

    return this.getAlertById(alertId);
  }
}
