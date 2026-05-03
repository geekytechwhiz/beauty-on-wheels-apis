import { randomUUID } from 'crypto';

import { BaseRepository } from '@api-hub/utils';

import { AlertEntityBuilder } from '../builder/alert-entity.builder';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import {
  ALERT_METADATA_SK,
  GSI1_ORG_QUEUE,
  GSI2_USER_QUEUE,
  GSI3_PATIENT,
  GROUP_MEMBERSHIP_SK_PREFIX,
} from '../constants/alert.constants';
import { DuplicateEventError } from '../errors/duplicate-event.error';

import type { AlertActivity } from '../models/domain/alert-activity.model';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { UpdateAlertRequest } from '../models/api/update-alert.request';
import { ALERT_STATE, type AlertState } from '../models/types/alert-state.type';

import {
  assertAlertTable,
  isEventConditionalFailure,
  toPublicActivity,
} from '../utils/alert.utils';
import { organizationIdsMatch } from '../utils/organization-ids-match';

/** Resolve alert id from a GSI Query row (full item or KEYS_ONLY / INCLUDE projection). */
function alertIdFromGsiRow(r: AlertDdbRecord): string | undefined {
  const id = typeof r.alertId === 'string' ? r.alertId.trim() : '';
  if (id) return id;
  const pk = typeof r.pk === 'string' ? r.pk : '';
  const m = /^ALERT#(.+)$/.exec(pk);
  const fromPk = m?.[1]?.trim();
  return fromPk || undefined;
}

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
    const groupMembershipPut = AlertEntityBuilder.buildGroupMembershipPut(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          { Put: { ...eventPut, Item: eventPut as unknown as Record<string, unknown> } },
          { Put: { ...alertPut, Item: alertPut as unknown as Record<string, unknown> } },
          { Put: { ...activityPut, Item: activityPut as unknown as Record<string, unknown> } },
          groupMembershipPut,
        ],
      });

      return alertPut;
    } catch (err: unknown) {
      if (isEventConditionalFailure(err)) {
        throw new DuplicateEventError(idempotencyKey);
      }
      throw err;
    }
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

    items = await this.hydrateAlertsFromGsiRows(table, items);

    if (opts.openOnly) {
      items = items.filter(
        (a) => a.alertState !== ALERT_STATE.RESOLVED && a.alertState !== ALERT_STATE.DISMISSED,
      );
    }

    if (opts.inputType) {
      items = items.filter((a) => a.inputType === opts.inputType);
    }

    return items;
  }

  async queryPatientAlertsPage(
    patientId: string,
    opts: {
      openOnly?: boolean;
      inputType?: string;
      limit?: number;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: AlertDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertAlertTable();

    let { items, lastEvaluatedKey } = await this.queryPage<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI3_PATIENT,
      KeyConditionExpression: 'gsi3pk = :p',
      ExpressionAttributeValues: {
        ':p': AlertKeyBuilder.toPatPartitionKey(patientId),
      },
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
    });

    items = await this.hydrateAlertsFromGsiRows(table, items);

    if (opts.openOnly) {
      items = items.filter(
        (a) => a.alertState !== ALERT_STATE.RESOLVED && a.alertState !== ALERT_STATE.DISMISSED,
      );
    }

    if (opts.inputType) {
      items = items.filter((a) => a.inputType === opts.inputType);
    }

    return { items, lastEvaluatedKey };
  }

  async queryOrgAlerts(
    organizationId: string,
    opts: { state?: AlertState; limit?: number; unassignedOnly?: boolean },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();
    const state = opts.state ?? ALERT_STATE.UNASSIGNED;

    let items = await this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI1_ORG_QUEUE,
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': AlertKeyBuilder.buildGsi1Pk(organizationId, state),
      },
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    });

    items = await this.hydrateAlertsFromGsiRows(table, items);

    if (opts.unassignedOnly) {
      items = items.filter((a) => !a.assignedToUserId);
    }

    return items;
  }

  async queryOrgAlertsPage(
    organizationId: string,
    opts: {
      state?: AlertState;
      limit?: number;
      unassignedOnly?: boolean;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: AlertDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertAlertTable();
    const state = opts.state ?? ALERT_STATE.UNASSIGNED;

    let { items, lastEvaluatedKey } = await this.queryPage<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI1_ORG_QUEUE,
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': AlertKeyBuilder.buildGsi1Pk(organizationId, state),
      },
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
    });

    items = await this.hydrateAlertsFromGsiRows(table, items);

    if (opts.unassignedOnly) {
      items = items.filter((a) => !a.assignedToUserId);
    }

    return { items, lastEvaluatedKey };
  }

  async queryUserAlerts(
    userId: string,
    opts: { state?: AlertState; limit?: number },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    const items = await this.query<AlertDdbRecord>({
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

    return this.hydrateAlertsFromGsiRows(table, items);
  }

  async queryUserAlertsPage(
    userId: string,
    opts: {
      state?: AlertState;
      limit?: number;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: AlertDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertAlertTable();

    let { items, lastEvaluatedKey } = await this.queryPage<AlertDdbRecord>({
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
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
    });

    items = await this.hydrateAlertsFromGsiRows(table, items);

    return { items, lastEvaluatedKey };
  }

  /**
   * Base-table `GROUP#<groupingKey>` + `Alert#<triggerTs>#<alertId>` membership rows, then BatchGet alert METADATA.
   */
  async queryAlertsByGroupingKey(groupingKey: string): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    const members = await this.queryAll<{ alertId?: string }>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pref)',
      ExpressionAttributeValues: {
        ':pk': AlertKeyBuilder.toGroupPartitionKey(groupingKey),
        ':pref': GROUP_MEMBERSHIP_SK_PREFIX,
      },
      ScanIndexForward: false,
    });

    const orderedIds = members.map((m) => m.alertId).filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (orderedIds.length === 0) return [];

    const byId = await this.batchGetAlertsById(table, orderedIds);
    return orderedIds.map((id) => byId.get(id)).filter((row): row is AlertDdbRecord => row != null);
  }

  private async hydrateAlertsFromGsiRows(table: string, gsiRows: AlertDdbRecord[]): Promise<AlertDdbRecord[]> {
    if (gsiRows.length === 0) return [];

    const orderedIds = gsiRows.map((r) => alertIdFromGsiRow(r)).filter((id): id is string => !!id);
    if (orderedIds.length === 0) return gsiRows;

    const byId = await this.batchGetAlertsById(table, orderedIds);
    const hydrated = orderedIds.map((id) => byId.get(id)).filter((row): row is AlertDdbRecord => row != null);

    if (hydrated.length === orderedIds.length) return hydrated;

    /** BatchGet misses (e.g. race): preserve partial GSI rows that at least had an id. */
    const fallbackById = new Map<string, AlertDdbRecord>();
    for (const r of gsiRows) {
      const id = alertIdFromGsiRow(r);
      if (id && !byId.has(id)) fallbackById.set(id, r);
    }
    return orderedIds
      .map((id) => byId.get(id) ?? fallbackById.get(id))
      .filter((row): row is AlertDdbRecord => row != null);
  }

  private async batchGetAlertsById(table: string, alertIds: string[]): Promise<Map<string, AlertDdbRecord>> {
    const map = new Map<string, AlertDdbRecord>();
    const unique = [...new Set(alertIds)];

    for (let i = 0; i < unique.length; i += 100) {
      const chunk = unique.slice(i, i + 100);
      const items = await this.batchGet<AlertDdbRecord>({
        RequestItems: {
          [table]: {
            Keys: chunk.map((id) => ({
              pk: AlertKeyBuilder.toAlertPk(id),
              sk: ALERT_METADATA_SK,
            })),
          },
        },
      });
      for (const item of items) {
        if (item?.alertId) map.set(item.alertId, item);
      }
    }

    return map;
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
}