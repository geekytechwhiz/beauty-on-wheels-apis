import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { marshall as awsMarshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import type { AlertRecord, AlertState, CreateAlertInput, UpdateAlertInput } from './alert.types';

/** `marshall` throws on `undefined` property values; Dynamo attributes omit if removed. */
function ddbMarshal(data: unknown) {
  return awsMarshall(data, { removeUndefinedValues: true });
}

const client = new DynamoDBClient({});

const TABLE = process.env.ALERT_TABLE ?? '';

function assertAlertTableConfigured(): void {
  if (!TABLE) {
    throw new Error('ALERT_TABLE environment variable is not set');
  }
}

const ALERT_SK = 'METADATA';
const EVENT_SK = 'METADATA';

/** Adds minutes in UTC and returns ISO-8601 (used for SLA due timestamps). */
function addMinutesIso(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

/** GSI-5 partition key: date portion of SLA due time (YYYY-MM-DD UTC). */
function slaDateBucketUtc(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * GSI-1 (Team queue) partition key: ORG#<OrgID> (Alert+Service+Table+DB+design-3, § GSI-1).
 * Accepts OrgID with or without ORG# prefix.
 */
function toOrgPartitionKey(organizationId: string): string {
  const id = organizationId.trim();
  return id.startsWith('ORG#') ? id : `ORG#${id}`;
}

/**
 * GSI-3 (Patient view) partition key: PAT#<PatientID> (design-3, § GSI-3). Accepts raw id or
 * PAT# prefix to avoid double-prefixing.
 */
function toPatPartitionKey(patientId: string): string {
  const id = patientId.trim();
  return id.startsWith('PAT#') ? id : `PAT#${id}`;
}

/** GSI-2 (My queue): USER#<AssignedToUserID> (design-3, § GSI-2). */
function toUserPartitionKey(userId: string): string {
  const id = userId.trim();
  return id.startsWith('USER#') ? id : `USER#${id}`;
}

/**
 * Default grouping key from design-3 (§ ALERT + GROUP), e.g. PAT#123|...|CRITICAL
 * in the Confluence example (Pipe-separated; patient segment uses PAT#).
 */
function buildDefaultGroupingKey(
  input: CreateAlertInput,
  patForGroup: string,
): string {
  if (input.severityHint) {
    return `${patForGroup}|${input.inputType}|${input.severityHint}`;
  }
  return `${patForGroup}|${input.inputType}`;
}

/**
 * GSI-1 sort: STATE#<AlertState>#PRIORITY#<Priority>#TS#<TriggerTimestamp>#<AlertID>
 * (design-3, § GSI-1; trailing AlertID for uniqueness when timestamps collide).
 */
function buildGsi1Sk(
  state: AlertState,
  priority: string,
  triggerTimestamp: string,
  alertId: string,
): string {
  return `STATE#${state}#PRIORITY#${priority}#TS#${triggerTimestamp}#${alertId}`;
}

/** GSI-2 sort key: assigned user’s queue — state, trigger time, alert id. */
function buildGsi2Sk(state: AlertState, triggerTimestamp: string, alertId: string): string {
  return `STATE#${state}#TS#${triggerTimestamp}#${alertId}`;
}

/** Assignment SLA window from env `ALERT_DEFAULT_ASSIGN_SLA_MINUTES` or default 60. */
function defaultAssignSlaMinutes(): number {
  const n = Number(process.env.ALERT_DEFAULT_ASSIGN_SLA_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/** Resolution SLA window from env `ALERT_DEFAULT_RESOLVE_SLA_MINUTES` or default 240. */
function defaultResolveSlaMinutes(): number {
  const n = Number(process.env.ALERT_DEFAULT_RESOLVE_SLA_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 240;
}

function isTransactionCanceled(err: unknown): err is { name: string; CancellationReasons?: { Code?: string }[] } {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'TransactionCanceledException';
}

/** Index of the GROUP transact item (after EVENT, ALERT, ACTIVITY). */
const GROUP_TRANSACT_ITEM_INDEX = 3;

function isGroupPutConditionalRace(err: unknown): boolean {
  if (!isTransactionCanceled(err)) return false;
  return (err.CancellationReasons ?? [])[GROUP_TRANSACT_ITEM_INDEX]?.Code === 'ConditionalCheckFailed';
}

export type EventIdResolution = 'missing' | 'foreign_org' | AlertRecord;

/**
 * DynamoDB access for the alert single-table model only.
 * Intended caller: `AlertService` in `@api-hub/alert-integration` — not HTTP handlers or controllers.
 *
 * @see `apps/alert-service/docs/http-api-implementation-guide.md` §3
 */
export class AlertRepository {
  /**
   * Looks up idempotency row `EVENT#<inputEventId>` / `METADATA`.
   * Persistence-only; idempotency *policy* (when to throw vs return duplicate) belongs in `AlertService`.
   *
   * - `missing` — no row or incomplete row; safe to create.
   * - `foreign_org` — row exists for a different `organizationId` (caller must not return another tenant’s alert).
   * - {@link AlertRecord} — same org replay; return this alert as duplicate.
   */
  async resolveInputEventId(inputEventId: string, organizationId: string): Promise<EventIdResolution> {
    assertAlertTableConfigured();
    const res = await client.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: ddbMarshal({ pk: `EVENT#${inputEventId}`, sk: EVENT_SK }),
      }),
    );
    if (!res.Item) return 'missing';
    const row = unmarshall(res.Item) as { organizationId?: string; alertId?: string };
    if (row.organizationId !== organizationId) return 'foreign_org';
    if (!row.alertId) return 'missing';
    const alert = await this.getAlertById(row.alertId);
    return alert ?? 'missing';
  }

  /** `GROUP#<groupingKey>` / `METADATA` row exists (strongly consistent get). */
  private async getGroupMetadataExists(groupingKey: string): Promise<boolean> {
    assertAlertTableConfigured();
    const res = await client.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: ddbMarshal({ pk: `GROUP#${groupingKey}`, sk: ALERT_SK }),
        ProjectionExpression: 'pk',
      }),
    );
    return !!res.Item;
  }

  /** Single-table get: main alert item `ALERT#<id>` / `METADATA`. */
  async getAlertById(alertId: string): Promise<AlertRecord | null> {
    assertAlertTableConfigured();
    const res = await client.send(
      new GetItemCommand({
        TableName: TABLE,
        Key: ddbMarshal({ pk: `ALERT#${alertId}`, sk: ALERT_SK }),
      }),
    );
    if (!res.Item) return null;
    return unmarshall(res.Item) as AlertRecord;
  }

  /**
   * Persists a new alert in one transaction: conditional EVENT put, ALERT put (with GSI1/3/4/5), ACTIVITY
   * (`ALERT_CREATED`), and GROUP: after a read, **Put** if no `GROUP#`/`METADATA` row exists, else **Update**
   * the existing row. If two creates race on first **Put**, the transact is retried once with **Update**.
   * Caller must ensure idempotency key is unused for this org.
   *
   * New alerts start `UNASSIGNED` with no GSI-2 keys until assigned.
   */
  async createAlert(input: CreateAlertInput): Promise<AlertRecord> {
    assertAlertTableConfigured();
    const alertId = randomUUID();
    const idempotencyId = input.inputEventId ?? randomUUID();
    const triggerTimestamp = input.triggerTimestamp;
    const now = new Date().toISOString();
    const state: AlertState = 'UNASSIGNED';
    const assignSlaMinutes = defaultAssignSlaMinutes();
    const resolveSlaMinutes = defaultResolveSlaMinutes();
    const assignSlaDueAt = addMinutesIso(now, assignSlaMinutes);
    const resolveSlaDueAt = addMinutesIso(now, assignSlaMinutes + resolveSlaMinutes);

    const priority = input.priority ?? 'P2';
    const patForGroup = toPatPartitionKey(input.patientId);
    const groupingKey = input.groupingKey ?? buildDefaultGroupingKey(input, patForGroup);

    const gsi1pk = toOrgPartitionKey(input.organizationId);
    const gsi1sk = buildGsi1Sk(state, priority, triggerTimestamp, alertId);
    const gsi3pk = toPatPartitionKey(input.patientId);
    // GSI-3 sort: TS#<TriggerTimestamp> (design-3, § GSI-3) + #<AlertID> for index uniqueness
    const gsi3sk = `TS#${triggerTimestamp}#${alertId}`;
    const gsi4pk = `GROUP#${groupingKey}`;
    // GSI-4 sort: TS#<TriggerTimestamp> (design-3, § GSI-4) + #<AlertId>
    const gsi4sk = `TS#${triggerTimestamp}#${alertId}`;
    const gsi5pk = `SLA#${slaDateBucketUtc(assignSlaDueAt)}`;
    // GSI-5 sort: TS#<SLADueAt> (design-3, § GSI-5) + #<AlertId>
    const gsi5sk = `TS#${assignSlaDueAt}#${alertId}`;

    const record: AlertRecord = {
      pk: `ALERT#${alertId}`,
      sk: ALERT_SK,
      entityType: 'ALERT',
      alertId,
      patientId: input.patientId,
      organizationId: input.organizationId,
      inputEventId: idempotencyId,
      inputType: input.inputType,
      sourceType: input.sourceType,
      alertState: state,
      priority,
      triggerTimestamp,
      triggerSummary: input.triggerSummary ?? '',
      evidencePayload: input.evidencePayload,
      slaBreachIndicator: false,
      groupingKey,
      gsi1pk,
      gsi1sk,
      gsi3pk,
      gsi3sk,
      gsi4pk,
      gsi4sk,
      gsi5pk,
      gsi5sk,
      carePlanInstanceId: input.carePlanInstanceId,
      packageAssignmentId: input.packageAssignmentId,
      appliesToType: input.appliesToType,
      linkedEntityCode: input.linkedEntityCode,
      severityHint: input.severityHint,
      alertPolicyTemplateVersionId: input.alertPolicyTemplateVersionId,
      thresholdTemplateVersionId: input.thresholdTemplateVersionId,
      triggerSummaryTemplateCode: input.triggerSummaryTemplateCode,
      triggerSummaryParams: input.triggerSummaryParams,
      assignSlaDueAt,
      resolveSlaDueAt,
      assignSlaMinutes,
      resolveSlaMinutes,
      createdAt: now,
      updatedAt: now,
    };

    const activityId = randomUUID();
    const activitySk = `ACTIVITY#${now}#${activityId}`;
    const actor = input.actorUserId ?? 'SYSTEM';

    const groupPk = `GROUP#${groupingKey}`;
    const baseTransactItems = (): TransactWriteItem[] => [
      {
        Put: {
          TableName: TABLE,
          Item: ddbMarshal({
            pk: `EVENT#${idempotencyId}`,
            sk: EVENT_SK,
            organizationId: input.organizationId,
            alertId,
            inputEventId: idempotencyId,
            createdAt: now,
          }),
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: ddbMarshal(record),
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: ddbMarshal({
            pk: record.pk,
            sk: activitySk,
            entityType: 'ACTIVITY',
            activityId,
            alertId,
            organizationId: input.organizationId,
            activityType: 'ALERT_CREATED',
            activityTimestamp: now,
            performedBy: actor,
          }),
        },
      },
    ];

    /** New GROUP row: Put (design-3, § 3. GROUP). */
    const groupPutItem = (): TransactWriteItem => ({
      Put: {
        TableName: TABLE,
        Item: ddbMarshal({
          pk: groupPk,
          sk: ALERT_SK,
          OpenCount: 1,
          LatestAlertTimestamp: triggerTimestamp,
          LastAlertId: alertId,
          HighestPriority: priority,
          PatientID: patForGroup,
          BreachedCount: 0,
          UpdatedAt: now,
        }),
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      },
    });

    /** Existing GROUP row: increment and refresh summary fields. */
    const groupUpdateItem = (): TransactWriteItem => ({
      Update: {
        TableName: TABLE,
        Key: ddbMarshal({ pk: groupPk, sk: ALERT_SK }),
        UpdateExpression: [
          'ADD OpenCount :one',
          'SET',
          '  LatestAlertTimestamp = :ts,',
          '  LastAlertId = :aid,',
          '  HighestPriority = :hp,',
          '  #ua = :now',
        ].join(' '),
        ExpressionAttributeNames: { '#ua': 'UpdatedAt' },
        ExpressionAttributeValues: ddbMarshal({
          ':one': 1,
          ':ts': triggerTimestamp,
          ':aid': alertId,
          ':hp': priority,
          ':now': now,
        }),
        ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      },
    });

    let useGroupPut = !(await this.getGroupMetadataExists(groupingKey));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await client.send(
          new TransactWriteItemsCommand({
            TransactItems: [...baseTransactItems(), useGroupPut ? groupPutItem() : groupUpdateItem()],
          }),
        );
        return record;
      } catch (e) {
        if (useGroupPut && isGroupPutConditionalRace(e) && attempt === 0) {
          useGroupPut = false;
          continue;
        }
        throw e;
      }
    }

    throw new Error('createAlert: unexpected group transaction retry exhaustion');
  }

  async queryPatientAlerts(
    patientId: string,
    opts: { openOnly?: boolean; inputType?: string; limit?: number },
  ): Promise<AlertRecord[]> {
    assertAlertTableConfigured();
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI3',
        KeyConditionExpression: 'gsi3pk = :p',
        ExpressionAttributeValues: ddbMarshal({
          ':p': toPatPartitionKey(patientId),
        }),
        ScanIndexForward: false,
        Limit: opts.limit ?? 50,
      }),
    );
    let items = (res.Items ?? []).map((i) => unmarshall(i) as AlertRecord);
    if (opts.openOnly) {
      items = items.filter((a) => a.alertState !== 'RESOLVED' && a.alertState !== 'DISMISSED');
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
    assertAlertTableConfigured();
    const state = opts.state ?? 'UNASSIGNED';
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :o AND begins_with(gsi1sk, :s)',
        ExpressionAttributeValues: ddbMarshal({
          ':o': toOrgPartitionKey(organizationId),
          ':s': `STATE#${state}#`,
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
    assertAlertTableConfigured();
    const base = {
      TableName: TABLE,
      IndexName: 'GSI2',
      ExpressionAttributeValues: ddbMarshal({
        ':u': toUserPartitionKey(userId),
        ...(opts.state ? { ':st': `STATE#${opts.state}#` } : {}),
      }),
      ScanIndexForward: false,
      Limit: opts.limit ?? 50,
    } as const;

    const res = await client.send(
      new QueryCommand({
        ...base,
        KeyConditionExpression: opts.state
          ? 'gsi2pk = :u AND begins_with(gsi2sk, :st)'
          : 'gsi2pk = :u',
      }),
    );
    return (res.Items ?? []).map((i) => unmarshall(i) as AlertRecord);
  }

  async updateAlert(alertId: string, patch: UpdateAlertInput): Promise<AlertRecord | null> {
    assertAlertTableConfigured();
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

    const gsi1sk = buildGsi1Sk(nextState, existing.priority, existing.triggerTimestamp, alertId);

    if (nextAssign) {
      const gsi2pk = toUserPartitionKey(nextAssign);
      const gsi2sk = buildGsi2Sk(nextState, existing.triggerTimestamp, alertId);
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: ddbMarshal({ pk: existing.pk, sk: existing.sk }),
          UpdateExpression:
            'SET alertState = :st, updatedAt = :u, gsi1sk = :g1s, slaBreachIndicator = :sla, assignedToUserId = :a, gsi2pk = :g2p, gsi2sk = :g2s',
          ExpressionAttributeValues: ddbMarshal({
            ':st': nextState,
            ':u': now,
            ':g1s': gsi1sk,
            ':sla': nextSla,
            ':a': nextAssign,
            ':g2p': gsi2pk,
            ':g2s': gsi2sk,
          }),
        }),
      );
    } else {
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: ddbMarshal({ pk: existing.pk, sk: existing.sk }),
          UpdateExpression:
            'SET alertState = :st, updatedAt = :u, gsi1sk = :g1s, slaBreachIndicator = :sla REMOVE assignedToUserId, gsi2pk, gsi2sk',
          ExpressionAttributeValues: ddbMarshal({
            ':st': nextState,
            ':u': now,
            ':g1s': gsi1sk,
            ':sla': nextSla,
          }),
        }),
      );
    }

    return this.getAlertById(alertId);
  }
}
