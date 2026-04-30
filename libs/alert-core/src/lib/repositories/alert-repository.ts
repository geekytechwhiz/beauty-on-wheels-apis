import { randomUUID } from 'crypto';

import { BaseRepository } from '@api-hub/utils';

import { AlertEntityBuilder } from '../builder/alert-entity.builder';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import {
  ALERT_METADATA_SK,
  GSI1_ORG_QUEUE,
  GSI2_USER_QUEUE,
  GSI3_PATIENT,
  GSI4_GROUP,
} from '../constants/alert.constants';
import { DuplicateEventError } from '../errors/duplicate-event.error';

import type { AlertActivity } from '../models/domain/alert-activity.model';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { UpdateAlertRequest } from '../models/api/update-alert.request';
import type { AlertState } from '../models/types/alert-state.type';

import {
  assertAlertTable,
  isEventConditionalFailure,
  isGroupPutConditionalRace,
  toPublicActivity,
} from '../utils/alert.utils';
import { organizationIdsMatch } from '../utils/organization-ids-match';

export class AlertRepository extends BaseRepository {
  /**
   * Idempotency: EVENT# row exists → same org returns alert row; other org → foreign_org; else missing.
   */
  async resolveInputEventId(
    inputEventId: string,
    organizationId: string,
  ): Promise<AlertDdbRecord | 'missing' | 'foreign_org'> {
    const table = assertAlertTable();
    const eventRow = await this.get<{ organizationId?: string; alertId?: string }>(table, {
      pk: AlertKeyBuilder.toEventPk(inputEventId),
      sk: ALERT_METADATA_SK,
    });
    if (!eventRow) return 'missing';
    if (!organizationIdsMatch(eventRow.organizationId, organizationId)) return 'foreign_org';
    const alertId = eventRow.alertId;
    if (!alertId) return 'missing';
    const record = await this.getAlertById(alertId);
    return record ?? 'missing';
  }

  async createAlert(input: CreateAlertRequest): Promise<AlertDdbRecord> {
    assertAlertTable();

    const alertId = randomUUID();
    const now = AlertEntityBuilder.nowIso();
    const idempotencyKey = input.inputEventId ?? randomUUID();

    const ctx = AlertEntityBuilder.buildCreateContext({
      alertId,
      now,
      input: { ...input, inputEventId: idempotencyKey },
    });

    const alertPut = AlertEntityBuilder.buildAlertRecord(ctx);
    const activityPut = AlertEntityBuilder.buildCreateActivity(ctx);
    const eventPut = AlertEntityBuilder.buildEvent(ctx);

    const groupExists = await this.getGroupMetadataExists(ctx.groupingKey);
    let useGroupPut = !groupExists;

    for (let attempt = 0; attempt < 2; attempt++) {
      const groupItem = useGroupPut
        ? AlertEntityBuilder.buildGroupPut(ctx)
        : AlertEntityBuilder.buildGroupUpdate(ctx);

      try {
        await this.transactWrite({
          TransactItems: [
            { Put: { ...eventPut, Item: eventPut as unknown as Record<string, unknown> } },
            { Put: { ...alertPut, Item: alertPut as unknown as Record<string, unknown> } },
            { Put: { ...activityPut, Item: activityPut as unknown as Record<string, unknown> } },
            groupItem,
          ],
        });

        return alertPut;
      } catch (err: unknown) {
        if (useGroupPut && isGroupPutConditionalRace(err) && attempt === 0) {
          useGroupPut = false;
          continue;
        }
        if (isEventConditionalFailure(err)) {
          throw new DuplicateEventError(idempotencyKey);
        }
        throw err;
      }
    }

    throw new Error('createAlert: unexpected group transaction retry exhaustion');
  }

  async getAlertById(alertId: string): Promise<AlertDdbRecord | null> {
    const table = assertAlertTable();

    return this.get<AlertDdbRecord>(table, {
      pk: AlertKeyBuilder.toAlertPk(alertId),
      sk: ALERT_METADATA_SK,
    });
  }

  async queryAlertActivities(alertId: string): Promise<AlertActivity[]> {
    const table = assertAlertTable();

    const rows = await this.queryAll<Record<string, unknown>>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :act)',
      ExpressionAttributeValues: {
        ':pk': AlertKeyBuilder.toAlertPk(alertId),
        ':act': 'ACTIVITY#',
      },
      ScanIndexForward: false,
    });

    return rows.map((r) => toPublicActivity(r));
  }

  async queryPatientAlerts(
    patientId: string,
    opts: { openOnly?: boolean; inputType?: string; limit?: number },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    let items = await this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI3_PATIENT,
      KeyConditionExpression: 'gsi3pk = :p',
      ExpressionAttributeValues: {
        ':p': AlertKeyBuilder.toPatPartitionKey(patientId),
      },
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    });

    if (opts.openOnly) {
      items = items.filter(
        (a) => a.alertState !== 'RESOLVED' && a.alertState !== 'DISMISSED',
      );
    }

    if (opts.inputType) {
      items = items.filter((a) => a.inputType === opts.inputType);
    }

    return items;
  }

  async queryOrgAlerts(
    organizationId: string,
    opts: { state?: AlertState; limit?: number; unassignedOnly?: boolean },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();
    const state = opts.state ?? 'UNASSIGNED';

    let items = await this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI1_ORG_QUEUE,
      KeyConditionExpression: 'gsi1pk = :o AND begins_with(gsi1sk, :s)',
      ExpressionAttributeValues: {
        ':o': AlertKeyBuilder.toOrgPartitionKey(organizationId),
        ':s': `STATE#${state}#`,
      },
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    });

    if (opts.unassignedOnly) {
      items = items.filter((a) => !a.assignedToUserId);
    }

    return items;
  }

  async queryUserAlerts(
    userId: string,
    opts: { state?: AlertState; limit?: number },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    return this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI2_USER_QUEUE,
      KeyConditionExpression: opts.state
        ? 'gsi2pk = :u AND begins_with(gsi2sk, :st)'
        : 'gsi2pk = :u',
      ExpressionAttributeValues: {
        ':u': AlertKeyBuilder.toUserPartitionKey(userId),
        ...(opts.state ? { ':st': `STATE#${opts.state}#` } : {}),
      },
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    });
  }

  async queryAlertsByGroupingKey(groupingKey: string): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    return this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI4_GROUP,
      KeyConditionExpression: 'gsi4pk = :g',
      ExpressionAttributeValues: {
        ':g': AlertKeyBuilder.toGroupPartitionKey(groupingKey),
      },
      ScanIndexForward: false,
    });
  }

  async updateAlert(
    alertId: string,
    patch: UpdateAlertRequest,
  ): Promise<AlertDdbRecord | null> {
    const existing = await this.getAlertById(alertId);
    if (!existing) return null;

    const updateParams = AlertEntityBuilder.buildUpdateExpression(
      existing,
      patch,
    );

    await this.update(updateParams);

    return this.getAlertById(alertId);
  }

  private async getGroupMetadataExists(groupingKey: string): Promise<boolean> {
    const table = assertAlertTable();

    const res = await this.get<{ pk?: string }>(table, {
      pk: AlertKeyBuilder.toGroupPartitionKey(groupingKey),
      sk: ALERT_METADATA_SK,
    });

    return !!res;
  }
}