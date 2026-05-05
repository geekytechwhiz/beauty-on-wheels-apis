import { randomUUID } from 'crypto';

import { BaseRepository } from '@api-hub/utils';

import { AlertEntityBuilder } from '../builder/alert-entity.builder';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import {
  ALERT_METADATA_SK,
  GSI1_ORG_QUEUE,
  GSI2_USER_QUEUE,
  GSI3_PATIENT,
  GSI4_ORG_WIDE,
  GROUP_MEMBERSHIP_SK_PREFIX,
  ACTIVITY_TYPE_NOTE_ADDED,
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
import { padEpochMs13 } from '../utils/alert-time';

/** Filters shared by TEAM (GSI4), MY (GSI2), and PATIENT (GSI3) list queries (HTTP list semantics). */
export type AlertListStructuredFilters = {
  state?: AlertState;
  priority?: string;
  inputType?: string;
  dateFrom?: string;
  dateTo?: string;
  assignedToUserId?: string;
};

/** MY queue (GSI2): structured filters + optional substring `search` (`contains` on alert id / patient id). */
export type QueryUserAlertsListOpts = AlertListStructuredFilters & { search?: string };

/** PATIENT (GSI3): structured filters; dates use `triggerTimestamp` (GSI3 sort key is not clinical trigger). */
export type QueryPatientAlertsListOpts = AlertListStructuredFilters & {
  openOnly?: boolean;
};

/** GSI2 / GSI4: constrain sort key to `[dateFrom, dateTo]` using `TS#…#` segment (same as {@link queryOrgAlertsGsi4Page}). */
function appendSortKeyTriggerTimeBounds(
  expressionAttributeValues: Record<string, unknown>,
  keyCondition: string,
  sortKeyAttr: 'gsi2sk' | 'gsi4sk',
  opts: Pick<AlertListStructuredFilters, 'dateFrom' | 'dateTo'>,
): string {
  let kc = keyCondition;
  const fromMs = opts.dateFrom?.trim() ? Date.parse(opts.dateFrom.trim()) : NaN;
  const toMs = opts.dateTo?.trim() ? Date.parse(opts.dateTo.trim()) : NaN;
  if (!Number.isNaN(fromMs)) {
    expressionAttributeValues[':skLo'] = `TS#${padEpochMs13(fromMs)}#`;
    kc += ` AND ${sortKeyAttr} >= :skLo`;
  }
  if (!Number.isNaN(toMs)) {
    expressionAttributeValues[':skHiEx'] = `TS#${padEpochMs13(toMs + 1)}#`;
    kc += ` AND ${sortKeyAttr} < :skHiEx`;
  }
  return kc;
}

/** State / priority / inputType — common `FilterExpression` fragments for list queries. */
function appendStatePriorityInputTypeFilters(
  expressionAttributeValues: Record<string, unknown>,
  filterParts: string[],
  opts: Pick<AlertListStructuredFilters, 'state' | 'priority' | 'inputType'>,
): void {
  if (opts.state) {
    expressionAttributeValues[':listSt'] = opts.state;
    filterParts.push('(alertState = :listSt)');
  }
  if (opts.priority?.trim()) {
    expressionAttributeValues[':prio'] = opts.priority.trim();
    filterParts.push('(priority = :prio)');
  }
  if (opts.inputType?.trim()) {
    expressionAttributeValues[':inType'] = opts.inputType.trim();
    filterParts.push('(inputType = :inType)');
  }
}

/** GSI3: clinical trigger range on the attribute (not on `gsi3sk`). */
function appendTriggerTimestampIsoRangeFilters(
  expressionAttributeValues: Record<string, unknown>,
  filterParts: string[],
  opts: Pick<AlertListStructuredFilters, 'dateFrom' | 'dateTo'>,
): void {
  const fromMs = opts.dateFrom?.trim() ? Date.parse(opts.dateFrom.trim()) : NaN;
  if (!Number.isNaN(fromMs)) {
    expressionAttributeValues[':trFrom'] = fromMs;
    filterParts.push('(triggerTimestamp >= :trFrom)');
  }
  const toMs = opts.dateTo?.trim() ? Date.parse(opts.dateTo.trim()) : NaN;
  if (!Number.isNaN(toMs)) {
    expressionAttributeValues[':trTo'] = toMs;
    filterParts.push('(triggerTimestamp <= :trTo)');
  }
}

function appendUnassignedOnlyFilter(
  expressionAttributeValues: Record<string, unknown>,
  filterParts: string[],
): void {
  expressionAttributeValues[':emptyAssignee'] = '';
  filterParts.push(
    '(attribute_not_exists(assignedToUserId) OR assignedToUserId = :emptyAssignee)',
  );
}

function appendAssignedToUserIdListFilter(
  expressionAttributeValues: Record<string, unknown>,
  filterParts: string[],
  assignedToUserId?: string,
): void {
  const uid = assignedToUserId?.trim();
  if (!uid) return;
  expressionAttributeValues[':listAssignedToUid'] = uid;
  filterParts.push('(assignedToUserId = :listAssignedToUid)');
}

function appendPatientOpenOnlyFilter(
  expressionAttributeValues: Record<string, unknown>,
  filterParts: string[],
): void {
  expressionAttributeValues[':stRes'] = ALERT_STATE.RESOLVED;
  expressionAttributeValues[':stDis'] = ALERT_STATE.DISMISSED;
  filterParts.push('(alertState <> :stRes AND alertState <> :stDis)');
}

/**
 * TEAM / MY only: Dynamo `contains` on alert id and patient id (case-sensitive; `Limit` applies before filter).
 */
function appendListSearchContainsFilter(
  expressionAttributeValues: Record<string, unknown>,
  filterParts: string[],
  search?: string,
): void {
  const q = search?.trim();
  if (!q) return;
  expressionAttributeValues[':qSrch'] = q;
  filterParts.push('(contains(alertId, :qSrch) OR contains(patientId, :qSrch))');
}

function buildGsi2UserListParams(userId: string, opts: QueryUserAlertsListOpts) {
  const eav: Record<string, unknown> = {
    ':u': AlertKeyBuilder.toUserPartitionKey(userId),
  };
  const keyCondition = appendSortKeyTriggerTimeBounds(eav, 'gsi2pk = :u', 'gsi2sk', opts);

  const filterParts: string[] = [];
  appendStatePriorityInputTypeFilters(eav, filterParts, opts);
  appendAssignedToUserIdListFilter(eav, filterParts, opts.assignedToUserId);
  appendListSearchContainsFilter(eav, filterParts, opts.search);

  return {
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: eav,
    ...(filterParts.length ? { FilterExpression: filterParts.join(' AND ') } : {}),
  };
}

function buildGsi3PatientFilterParts(opts: QueryPatientAlertsListOpts) {
  const eav: Record<string, unknown> = {};
  const filterParts: string[] = [];

  appendStatePriorityInputTypeFilters(eav, filterParts, opts);
  appendAssignedToUserIdListFilter(eav, filterParts, opts.assignedToUserId);
  appendTriggerTimestampIsoRangeFilters(eav, filterParts, opts);
  if (opts.openOnly) {
    appendPatientOpenOnlyFilter(eav, filterParts);
  }

  return {
    ExpressionAttributeValues: eav,
    ...(filterParts.length ? { FilterExpression: filterParts.join(' AND ') } : {}),
  };
}

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
    const table = assertAlertTable();

    const alertId = randomUUID();
    const idempotencyKey = input.inputEventId ?? randomUUID();

    const ctx = AlertEntityBuilder.buildCreateContext({
      alertId,
      input: { ...input, inputEventId: idempotencyKey },
    });

    const alertPut = AlertEntityBuilder.buildAlertRecord(ctx);
    const activityPut = AlertEntityBuilder.buildCreateActivity(ctx);
    const eventPut = AlertEntityBuilder.buildEvent(ctx);
    const groupMembershipPut = AlertEntityBuilder.buildGroupMembershipPut(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: table, Item: eventPut as unknown as Record<string, unknown> } },
          { Put: { TableName: table, Item: alertPut as unknown as Record<string, unknown> } },
          { Put: { TableName: table, Item: activityPut as unknown as Record<string, unknown> } },
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

  async queryAlertActivities(
    alertId: string,
    opts?: { notesOnly?: boolean },
  ): Promise<AlertActivity[]> {
    const table = assertAlertTable();

    const expressionAttributeValues: Record<string, unknown> = {
      ':pk': AlertKeyBuilder.toAlertPk(alertId),
      ':act': 'ACTIVITY#',
    };
    if (opts?.notesOnly) {
      expressionAttributeValues[':noteType'] = ACTIVITY_TYPE_NOTE_ADDED;
    }

    const rows = await this.queryAll<Record<string, unknown>>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :act)',
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false,
      ...(opts?.notesOnly ? { FilterExpression: 'activityType = :noteType' } : {}),
    });

    return rows.map((r) => toPublicActivity(r));
  }

  async queryPatientAlerts(
    patientId: string,
    opts: QueryPatientAlertsListOpts & { limit?: number },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    const filterBuilt = buildGsi3PatientFilterParts(opts);
    const expressionAttributeValues: Record<string, unknown> = {
      ':p': AlertKeyBuilder.toPatPartitionKey(patientId),
      ...filterBuilt.ExpressionAttributeValues,
    };

    let items = await this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI3_PATIENT,
      KeyConditionExpression: 'gsi3pk = :p',
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
      ...(filterBuilt.FilterExpression ? { FilterExpression: filterBuilt.FilterExpression } : {}),
    });

    items = await this.hydrateAlertsFromGsiRows(table, items);

    return items;
  }

  async queryPatientAlertsPage(
    patientId: string,
    opts: QueryPatientAlertsListOpts & {
      limit?: number;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: AlertDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertAlertTable();

    const filterBuilt = buildGsi3PatientFilterParts(opts);
    const expressionAttributeValues: Record<string, unknown> = {
      ':p': AlertKeyBuilder.toPatPartitionKey(patientId),
      ...filterBuilt.ExpressionAttributeValues,
    };

    let { items, lastEvaluatedKey } = await this.queryPage<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI3_PATIENT,
      KeyConditionExpression: 'gsi3pk = :p',
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
      ...(filterBuilt.FilterExpression ? { FilterExpression: filterBuilt.FilterExpression } : {}),
    });

    items = await this.hydrateAlertsFromGsiRows(table, items);

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

  /**
   * Org-wide alert list (GSI4): `gsi4pk` = org, `gsi4sk` = trigger-time order.
   * Filters use DynamoDB `FilterExpression` where possible; optional `search` uses `contains` (TEAM queue).
   */
  async queryOrgAlertsGsi4Page(
    organizationId: string,
    opts: {
      limit: number;
      exclusiveStartKey?: Record<string, unknown>;
      state?: AlertState;
      /** Internal: post-filter alerts with no assignee (legacy org list callers). */
      unassignedOnly?: boolean;
      search?: string;
    } & AlertListStructuredFilters,
  ): Promise<{ items: AlertDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertAlertTable();
    const pkVal = AlertKeyBuilder.buildGsi4Pk(organizationId);

    const expressionAttributeValues: Record<string, unknown> = { ':pk': pkVal };
    const keyCondition = appendSortKeyTriggerTimeBounds(
      expressionAttributeValues,
      'gsi4pk = :pk',
      'gsi4sk',
      opts,
    );

    const filterParts: string[] = [];
    appendStatePriorityInputTypeFilters(expressionAttributeValues, filterParts, opts);
    if (opts.unassignedOnly) {
      appendUnassignedOnlyFilter(expressionAttributeValues, filterParts);
    }
    appendAssignedToUserIdListFilter(expressionAttributeValues, filterParts, opts.assignedToUserId);
    appendListSearchContainsFilter(expressionAttributeValues, filterParts, opts.search);

    const targetCount = Math.max(1, opts.limit ?? 50);
    const maxRounds = 5;

    const baseParams = {
      TableName: table,
      IndexName: GSI4_ORG_WIDE,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false,
      Limit: targetCount,
      ...(filterParts.length
        ? { FilterExpression: filterParts.join(' AND ') }
        : {}),
    };

    const out: AlertDdbRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined = opts.exclusiveStartKey;
    let lastKey: Record<string, unknown> | undefined;
    let round = 0;

    do {
      const { items, lastEvaluatedKey } = await this.queryPage<AlertDdbRecord>({
        ...baseParams,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      });
      const hydrated = await this.hydrateAlertsFromGsiRows(table, items);
      out.push(...hydrated);
      lastKey = lastEvaluatedKey;
      exclusiveStartKey = lastEvaluatedKey;
      round++;
    } while (out.length < targetCount && lastKey != null && round < maxRounds);

    return {
      items: out.slice(0, targetCount),
      lastEvaluatedKey: lastKey,
    };
  }

  async queryUserAlerts(
    userId: string,
    opts: QueryUserAlertsListOpts & { limit?: number },
  ): Promise<AlertDdbRecord[]> {
    const table = assertAlertTable();

    const built = buildGsi2UserListParams(userId, opts);

    const items = await this.query<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI2_USER_QUEUE,
      KeyConditionExpression: built.KeyConditionExpression,
      ExpressionAttributeValues: built.ExpressionAttributeValues,
      ...(built.FilterExpression ? { FilterExpression: built.FilterExpression } : {}),
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    });

    return this.hydrateAlertsFromGsiRows(table, items);
  }

  async queryUserAlertsPage(
    userId: string,
    opts: QueryUserAlertsListOpts & {
      limit?: number;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: AlertDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertAlertTable();

    const built = buildGsi2UserListParams(userId, opts);

    let { items, lastEvaluatedKey } = await this.queryPage<AlertDdbRecord>({
      TableName: table,
      IndexName: GSI2_USER_QUEUE,
      KeyConditionExpression: built.KeyConditionExpression,
      ExpressionAttributeValues: built.ExpressionAttributeValues,
      ...(built.FilterExpression ? { FilterExpression: built.FilterExpression } : {}),
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
    options?: { activityItems?: Record<string, unknown>[] },
  ): Promise<AlertDdbRecord | null> {
    const existing = await this.getAlertById(alertId);
    if (!existing) return null;

    const updateParams = AlertEntityBuilder.buildUpdateExpression(
      existing,
      patch,
    );

    const activities = options?.activityItems?.filter((x) => x && typeof x === 'object') ?? [];

    if (activities.length === 0) {
      await this.update(updateParams);
    } else {
      const table = updateParams.TableName as string;
      await this.transactWrite({
        TransactItems: [
          {
            Update: {
              TableName: table,
              Key: updateParams.Key,
              UpdateExpression: updateParams.UpdateExpression,
              ExpressionAttributeNames: updateParams.ExpressionAttributeNames,
              ExpressionAttributeValues: updateParams.ExpressionAttributeValues,
            },
          },
          ...activities.map((raw) => ({
            Put: {
              TableName: table,
              Item: raw as Record<string, unknown>,
            },
          })),
        ],
      });
    }

    return this.getAlertById(alertId);
  }

  /**
   * Add a NOTE_ADDED activity row for an alert. Returns the created public activity object.
   */
  async addNoteActivity(
    alertId: string,
    organizationId: string,
    comment: string,
    performedBy: string,
    performedByDisplayName?: string,
  ): Promise<AlertActivity> {
    const existing = await this.getAlertById(alertId);
    if (!existing) throw Object.assign(new Error('Alert not found'), { statusCode: 404, code: 'NOT_FOUND' });
    if (!organizationIdsMatch(existing.organizationId, organizationId)) {
      throw Object.assign(new Error('Alert not found'), { statusCode: 404, code: 'NOT_FOUND' });
    }

    const nowMs = Date.now();
    const raw = AlertEntityBuilder.buildWorkflowActivityRow({
      alertId,
      organizationId,
      nowMs,
      activityType: ACTIVITY_TYPE_NOTE_ADDED,
      performedBy: performedBy?.trim() || 'SYSTEM',
      performedByDisplayName: performedByDisplayName,
      activityComment: comment,
    });

    // Direct Put for activity only, no alert metadata update
    const table = assertAlertTable();
    await this.put(table, raw);

    // Return the public activity representation we just inserted; query latest activities and return first
    const acts = await this.queryAlertActivities(alertId);
    if (!acts || acts.length === 0) throw new Error('Activity not found after insert');
    return acts[0] as AlertActivity;
  }
}