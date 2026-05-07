import {
  ACTIVITY_TYPE_NOTE_ADDED,
  ALERT_METADATA_SK,
  DEFAULT_ASSIGN_SLA_MINUTES,
  DEFAULT_RESOLVE_SLA_MINUTES,
} from '../constants/alert.constants';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import { DuplicateEventError } from '../errors/duplicate-event.error';
import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertRepository } from './alert-repository';

const MS_PER_MINUTE = 60_000;

const TABLE = 'test-alert-table';

function createRequest(overrides: Partial<CreateAlertRequest> = {}): CreateAlertRequest {
  return {
    organizationId: 'org-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    patientId: 'pat-1',
    triggerTimestamp: '2026-01-15T10:00:00.000Z',
    evidencePayload: {},
    ...overrides,
  };
}

describe('AlertRepository', () => {
  let repo: AlertRepository;

  beforeEach(() => {
    process.env.ALERT_TABLE = TABLE;
    repo = new AlertRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ALERT_TABLE;
  });

  describe('resolveInputEventId', () => {
    it('returns missing when EVENT row does not exist', async () => {
      const get = jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue(null);

      await expect(repo.resolveInputEventId('evt-1', 'org-1')).resolves.toBe('missing');

      expect(get).toHaveBeenCalledWith(TABLE, {
        pk: AlertKeyBuilder.toEventPk('evt-1'),
        sk: ALERT_METADATA_SK,
      });
    });

    it('returns foreign_org when event row belongs to another organization', async () => {
      jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue({
        organizationId: 'other-org',
        alertId: 'a1',
      });

      await expect(repo.resolveInputEventId('evt-1', 'org-1')).resolves.toBe('foreign_org');
    });

    it('returns missing when event row has no alertId', async () => {
      jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue({
        organizationId: 'org-1',
      });

      await expect(repo.resolveInputEventId('evt-1', 'org-1')).resolves.toBe('missing');
    });

    it('loads alert METADATA when event maps to same org', async () => {
      const alertRow = { alertId: 'a1', organizationId: 'org-1', pk: 'ALERT#a1', sk: ALERT_METADATA_SK };
      const get = jest
        .spyOn(repo as unknown as { get: jest.Mock }, 'get')
        .mockImplementation(async (_table: string, key: { pk: string }) => {
          if (key.pk.startsWith('EVENT#')) {
            return { organizationId: 'org-1', alertId: 'a1' };
          }
          return alertRow;
        });

      await expect(repo.resolveInputEventId('evt-1', 'org-1')).resolves.toEqual(alertRow);
      expect(get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAlertById', () => {
    it('returns null when no item', async () => {
      jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue(null);
      await expect(repo.getAlertById('nope')).resolves.toBeNull();
    });

    it('returns item when present', async () => {
      const row = { alertId: 'a1' } as AlertDdbRecord;
      jest.spyOn(repo as unknown as { get: jest.Mock }, 'get').mockResolvedValue(row);
      await expect(repo.getAlertById('a1')).resolves.toBe(row);
    });
  });

  describe('queryAlertActivities', () => {
    it('maps query rows through toPublicActivity', async () => {
      const queryAll = jest
        .spyOn(repo as unknown as { queryAll: jest.Mock }, 'queryAll')
        .mockResolvedValue([
          {
            pk: 'ALERT#a1',
            sk: 'ACTIVITY#ts#id',
            activityType: 'ALERT_CREATED',
            activityId: 'act-1',
          },
        ]);

      const items = await repo.queryAlertActivities('a1');

      expect(queryAll).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :act)',
          ExpressionAttributeValues: {
            ':pk': AlertKeyBuilder.toAlertPk('a1'),
            ':act': 'ACTIVITY#',
          },
        }),
      );
      expect(items[0]).toEqual(
        expect.objectContaining({
          activityType: 'ALERT_CREATED',
          activityId: 'act-1',
        }),
      );
      expect(items[0]).not.toHaveProperty('pk');
    });

    it('applies FilterExpression when notesOnly is true', async () => {
      const queryAll = jest.spyOn(repo as unknown as { queryAll: jest.Mock }, 'queryAll').mockResolvedValue([]);

      await repo.queryAlertActivities('a1', { notesOnly: true });

      expect(queryAll).toHaveBeenCalledWith(
        expect.objectContaining({
          FilterExpression: 'activityType = :noteType',
          ExpressionAttributeValues: expect.objectContaining({
            ':pk': AlertKeyBuilder.toAlertPk('a1'),
            ':act': 'ACTIVITY#',
            ':noteType': ACTIVITY_TYPE_NOTE_ADDED,
          }),
        }),
      );
    });
  });

  describe('createAlert', () => {
    it('persists via transact write and returns alert item shape', async () => {
      const tw = jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);

      const input = createRequest({ inputEventId: 'evt-create-1' });
      const out = await repo.createAlert(input);

      expect(out.organizationId).toBe('org-1');
      expect(out.inputEventId).toBe('evt-create-1');
      expect(out.alertId).toBeDefined();
      expect(tw).toHaveBeenCalledTimes(1);
      const items = tw.mock.calls[0][0].TransactItems;
      expect(items).toHaveLength(4);
      for (const op of items.slice(0, 3) as { Put: { Item: Record<string, unknown> } }[]) {
        expect(op.Put.Item).not.toHaveProperty('TableName');
      }
    });

    it('throws DuplicateEventError on idempotency conditional failure', async () => {
      jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      });

      await expect(repo.createAlert(createRequest({ inputEventId: 'evt-dup' }))).rejects.toBeInstanceOf(
        DuplicateEventError,
      );
    });

    it('uses DEFAULT_*_SLA_MINUTES when input omits SLA fields and starts assign-SLA at creation', async () => {
      jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);

      const out = await repo.createAlert(createRequest({ inputEventId: 'evt-sla-default' }));

      expect(out.assignSlaMinutes).toBe(DEFAULT_ASSIGN_SLA_MINUTES);
      expect(out.resolveSlaMinutes).toBe(DEFAULT_RESOLVE_SLA_MINUTES);
      expect(out.assignSlaDueAt).toBe((out.createdAt as number) + DEFAULT_ASSIGN_SLA_MINUTES * MS_PER_MINUTE);
      expect(out.resolveSlaDueAt).toBeUndefined();
      expect(out.gsi5pk).toBe(AlertKeyBuilder.toSlaPartitionKey(out.assignSlaDueAt as number));
      expect(out.gsi5sk).toBe(AlertKeyBuilder.toSlaSortKey(out.assignSlaDueAt as number, out.alertId));
    });

    it('honors caller-provided assignSlaMinutes / resolveSlaMinutes', async () => {
      jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);

      const out = await repo.createAlert(
        createRequest({ inputEventId: 'evt-sla-custom', assignSlaMinutes: 15, resolveSlaMinutes: 90 }),
      );

      expect(out.assignSlaMinutes).toBe(15);
      expect(out.resolveSlaMinutes).toBe(90);
      expect(out.assignSlaDueAt).toBe((out.createdAt as number) + 15 * MS_PER_MINUTE);
    });

    it('treats 0 minutes as "no SLA tracked" (no due-at math; sentinel = createdAt)', async () => {
      jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);

      const out = await repo.createAlert(
        createRequest({ inputEventId: 'evt-sla-zero', assignSlaMinutes: 0, resolveSlaMinutes: 0 }),
      );

      expect(out.assignSlaMinutes).toBe(0);
      expect(out.resolveSlaMinutes).toBe(0);
      expect(out.assignSlaDueAt).toBe(out.createdAt as number);
      expect(out.gsi5pk).toBe(AlertKeyBuilder.toSlaPartitionKey(out.createdAt as number));
    });
  });

  describe('queryPatientAlertsPage', () => {
    it('hydrates GSI rows via batchGet', async () => {
      const queryPageSpy = jest
        .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
        .mockResolvedValue({
          items: [{ alertId: 'hid-1' }],
          lastEvaluatedKey: { k: 'cont' },
        });

      const page = await repo.queryPatientAlertsPage('pat-1', { limit: 10 });

      expect(page.items).toEqual([{ alertId: 'hid-1' }]);
      expect(page.lastEvaluatedKey).toEqual({ k: 'cont' });
      expect(queryPageSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('queryOrgAlertsPage', () => {
    it('queries org GSI by org+state partition and hydrates', async () => {
      const hydrated: AlertDdbRecord = {
        alertId: 'o1',
        organizationId: 'org-1',
        pk: 'ALERT#o1',
        sk: ALERT_METADATA_SK,
      } as AlertDdbRecord;

      const queryPageSpy = jest.spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage').mockResolvedValue({
        items: [{ alertId: 'o1' }],
      });
      jest.spyOn(repo as unknown as { batchGet: jest.Mock }, 'batchGet').mockResolvedValue([hydrated]);

      const page = await repo.queryOrgAlertsPage('org-1', {
        state: ALERT_STATE.ASSIGNED,
        unassignedOnly: true,
        limit: 5,
      });

      expect(page.items.length).toBeGreaterThanOrEqual(1);
      expect(queryPageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: {
            ':pk': AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
          },
          Limit: 5,
        }),
      );
    });
  });

  it('getAlertsById batches >100 ids and returns map', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `a-${i}`);
    const batchGet = jest
      .spyOn(repo as unknown as { batchGet: jest.Mock }, 'batchGet')
      .mockImplementation(async ({ RequestItems }: { RequestItems: Record<string, { Keys: { pk: string; sk: string }[] }> }) => {
        const keys = RequestItems[TABLE].Keys;
        const first = keys[0];
        const alertId = String(first.pk).replace(/^ALERT#/, '');
        return [{ alertId }];
      });

    const map = await repo.getAlertsById(ids);
    expect(batchGet).toHaveBeenCalledTimes(2);
    expect(map.size).toBeGreaterThanOrEqual(1);
  });

  it('queryUserAlertsPage applies sort bounds + contains search + filters', async () => {
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: { k: 'n' } });

    const page = await repo.queryUserAlertsPage('user-1', {
      limit: 5,
      state: ALERT_STATE.ASSIGNED,
      assignedToUserId: 'user-1',
      priority: 'P1',
      inputType: 'MISSED_READING',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-02T00:00:00.000Z',
      search: 'pat',
      exclusiveStartKey: { k: 'start' },
    });

    expect(page.items).toEqual([]);
    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: TABLE,
        IndexName: 'GSI2',
        Limit: 5,
        ExclusiveStartKey: { k: 'start' },
        KeyConditionExpression: expect.stringContaining('gsi2pk = :u'),
        ExpressionAttributeValues: expect.objectContaining({
          ':u': AlertKeyBuilder.toUserPartitionKey('user-1'),
          ':qSrch': 'pat',
          ':listAssignedToUid': 'user-1',
          ':prio': 'P1',
          ':inType': 'MISSED_READING',
          ':listSt': ALERT_STATE.ASSIGNED,
        }),
        FilterExpression: expect.any(String),
      }),
    );
  });

  it('queryOrgAlertsGsi4Page loops to fill results (multi-round)', async () => {
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValueOnce({ items: [{ alertId: 'a1' }], lastEvaluatedKey: { k: '1' } })
      .mockResolvedValueOnce({ items: [{ alertId: 'a2' }], lastEvaluatedKey: { k: '2' } });

    const page = await repo.queryOrgAlertsGsi4Page('org-1', {
      limit: 2,
      state: ALERT_STATE.UNASSIGNED,
      unassignedOnly: true,
      search: 'a',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-02T00:00:00.000Z',
      assignedToUserId: 'user-1',
      priority: 'P2',
      inputType: 'MISSED_READING',
    });

    expect(page.items.length).toBe(2);
    expect(queryPage).toHaveBeenCalledTimes(2);
    expect(page.lastEvaluatedKey).toEqual({ k: '2' });
  });

  it('queryPatientAlertsPage applies triggerTimestamp range + openOnly', async () => {
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientAlertsPage('pat-1', {
      limit: 10,
      openOnly: true,
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-02T00:00:00.000Z',
      state: ALERT_STATE.ASSIGNED,
      priority: 'P1',
      inputType: 'MISSED_READING',
      assignedToUserId: 'user-1',
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: 'GSI3',
        KeyConditionExpression: 'gsi3pk = :p',
        ExpressionAttributeValues: expect.objectContaining({
          ':p': AlertKeyBuilder.toPatPartitionKey('pat-1'),
          ':trFrom': expect.any(Number),
          ':trTo': expect.any(Number),
          ':stRes': ALERT_STATE.RESOLVED,
          ':stDis': ALERT_STATE.DISMISSED,
        }),
        FilterExpression: expect.any(String),
      }),
    );
  });

  it('queryPatientAlerts applies openOnly via FilterExpression', async () => {
    const query = jest.spyOn(repo as unknown as { query: jest.Mock }, 'query').mockResolvedValue([]);

    await repo.queryPatientAlerts('pat-1', {
      limit: 10,
      openOnly: true,
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-02T00:00:00.000Z',
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: 'GSI3',
        FilterExpression: expect.stringContaining('alertState <> :stRes'),
        ExpressionAttributeValues: expect.objectContaining({
          ':stRes': ALERT_STATE.RESOLVED,
          ':stDis': ALERT_STATE.DISMISSED,
        }),
      }),
    );
  });

  it('queryAlertActivities covers both notesOnly branches explicitly', async () => {
    const queryAll = jest
      .spyOn(repo as unknown as { queryAll: jest.Mock }, 'queryAll')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await repo.queryAlertActivities('a1');
    await repo.queryAlertActivities('a1', { notesOnly: true });

    expect(queryAll).toHaveBeenCalledTimes(2);
  });

  it('createAlert rethrows non-idempotency errors', async () => {
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue(new Error('boom'));

    await expect(
      repo.createAlert({
        organizationId: 'org-1',
        inputType: 'MISSED_READING',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        triggerTimestamp: '2026-01-15T10:00:00.000Z',
        evidencePayload: {},
      } as Parameters<AlertRepository['createAlert']>[0]),
    ).rejects.toThrow('boom');
  });

  it('createAlert uses inputEventId fallback and can still throw DuplicateEventError', async () => {
    jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockRejectedValue({
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });

    await expect(
      repo.createAlert({
        organizationId: 'org-1',
        inputType: 'MISSED_READING',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        triggerTimestamp: '2026-01-15T10:00:00.000Z',
        evidencePayload: {},
      } as Parameters<AlertRepository['createAlert']>[0]),
    ).rejects.toBeInstanceOf(DuplicateEventError);
  });

  it('queryOrgAlerts and queryOrgAlertsPage cover unassignedOnly filtering', async () => {
    jest.spyOn(repo as unknown as { query: jest.Mock }, 'query').mockResolvedValue([
      { alertId: 'a1', assignedToUserId: 'u1' },
      { alertId: 'a2' },
    ]);
    jest.spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage').mockResolvedValue({
      items: [
        { alertId: 'b1', assignedToUserId: 'u1' },
        { alertId: 'b2' },
      ],
      lastEvaluatedKey: { k: 'n' },
    });

    const list = await repo.queryOrgAlerts('org-1', { unassignedOnly: true });
    expect(list.map((x) => x.alertId)).toEqual(['a2']);

    const listNoFilter = await repo.queryOrgAlerts('org-1', { limit: 2 });
    expect(listNoFilter.map((x) => x.alertId)).toEqual(['a1', 'a2']);

    const page = await repo.queryOrgAlertsPage('org-1', { unassignedOnly: true });
    expect(page.items.map((x) => x.alertId)).toEqual(['b2']);
  });

  it('queryOrgAlerts builds GSI1 params (state + limit)', async () => {
    const query = jest.spyOn(repo as unknown as { query: jest.Mock }, 'query').mockResolvedValue([]);

    await repo.queryOrgAlerts('org-1', { state: ALERT_STATE.ASSIGNED, limit: 7 });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
        },
        Limit: 7,
      }),
    );
  });

  it('queryOrgAlertsGsi4Page returns single page when enough items', async () => {
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [{ alertId: 'a1' }, { alertId: 'a2' }], lastEvaluatedKey: { k: 'n' } });

    const page = await repo.queryOrgAlertsGsi4Page('org-1', {
      limit: 2,
    });

    expect(page.items).toEqual([{ alertId: 'a1' }, { alertId: 'a2' }]);
    expect(page.lastEvaluatedKey).toEqual({ k: 'n' });
    expect(queryPage).toHaveBeenCalledTimes(1);
    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        IndexName: 'GSI4',
        Limit: 2,
        KeyConditionExpression: expect.stringContaining('gsi4pk = :pk'),
      }),
    );
  });

  it('queryOrgAlertsGsi4Page stops when no LastEvaluatedKey (even if not filled)', async () => {
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValueOnce({ items: [{ alertId: 'a1' }], lastEvaluatedKey: undefined });

    const page = await repo.queryOrgAlertsGsi4Page('org-1', {
      limit: 2,
      dateFrom: 'not-a-date',
      dateTo: 'also-not-a-date',
    } as Parameters<AlertRepository['queryOrgAlertsGsi4Page']>[1]);

    expect(page.items).toEqual([{ alertId: 'a1' }]);
    expect(page.lastEvaluatedKey).toBeUndefined();
    expect(queryPage).toHaveBeenCalledTimes(1);
  });

  it('queryAlertsByGroupingKey returns [] when no membership rows', async () => {
    jest.spyOn(repo as unknown as { queryAll: jest.Mock }, 'queryAll').mockResolvedValue([]);

    await expect(repo.queryAlertsByGroupingKey('grp-1')).resolves.toEqual([]);
  });

  it('queryAlertsByGroupingKey preserves order and filters invalid membership ids', async () => {
    jest.spyOn(repo as unknown as { queryAll: jest.Mock }, 'queryAll').mockResolvedValue([
      { alertId: '' },
      { alertId: undefined },
      { alertId: 'a2' },
      { alertId: 'a1' },
      { alertId: 123 },
    ]);

    const batchGet = jest.spyOn(repo as unknown as { batchGet: jest.Mock }, 'batchGet').mockResolvedValue([
      { alertId: 'a1', pk: 'ALERT#a1', sk: ALERT_METADATA_SK },
      { alertId: 'a2', pk: 'ALERT#a2', sk: ALERT_METADATA_SK },
    ]);

    const out = await repo.queryAlertsByGroupingKey('grp-1');
    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(out.map((x) => x.alertId)).toEqual(['a2', 'a1']);
  });

  it('updateAlert returns null when alert missing', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValue(null);
    await expect(repo.updateAlert('a1', { priority: 'P1' } as never)).resolves.toBeNull();
  });

  it('updateAlert uses update when no activityItems', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
    } as AlertDdbRecord);
    const update = jest.spyOn(repo as unknown as { update: jest.Mock }, 'update').mockResolvedValue(undefined);
    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
      priority: 'P1',
    } as AlertDdbRecord);

    const out = await repo.updateAlert('a1', { priority: 'P1' } as never, {
      activityItems: [null as never, 123 as never, 'nope' as never],
      performedByUserId: 'user-1',
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(out).toEqual(expect.objectContaining({ alertId: 'a1', priority: 'P1' }));
  });

  it('updateAlert uses transactWrite when there are valid activityItems', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
    } as AlertDdbRecord);

    const tw = jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);
    const update = jest.spyOn(repo as unknown as { update: jest.Mock }, 'update').mockResolvedValue(undefined);

    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
      priority: 'P2',
    } as AlertDdbRecord);

    const out = await repo.updateAlert('a1', { priority: 'P2' } as never, {
      activityItems: [{ pk: 'x', sk: 'y' }],
    });

    expect(update).not.toHaveBeenCalled();
    expect(tw).toHaveBeenCalledTimes(1);
    const items = tw.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    expect(out).toEqual(expect.objectContaining({ alertId: 'a1', priority: 'P2' }));
  });

  it('updateAlertsTransaction is a no-op when updates is empty', async () => {
    const tw = jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);
    await expect(repo.updateAlertsTransaction([])).resolves.toBeUndefined();
    expect(tw).not.toHaveBeenCalled();
  });

  it('updateAlertsTransaction writes updates and activity puts', async () => {
    const tw = jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);

    await repo.updateAlertsTransaction([
      {
        existing: { alertId: 'a1', organizationId: 'org-1', pk: 'ALERT#a1', sk: ALERT_METADATA_SK } as AlertDdbRecord,
        patch: { priority: 'P1' } as never,
        activityItems: [{ pk: 'A', sk: '1' }, null as never, 123 as never] as never,
        performedByUserId: 'user-1',
      },
      {
        existing: { alertId: 'a2', organizationId: 'org-1', pk: 'ALERT#a2', sk: ALERT_METADATA_SK } as AlertDdbRecord,
        patch: { priority: 'P2' } as never,
      },
    ]);

    expect(tw).toHaveBeenCalledTimes(1);
    const items = tw.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(3);
  });

  it('addNoteActivity throws 404 when alert not found', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValue(null);
    await expect(repo.addNoteActivity('a1', 'org-1', 'hello', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('addNoteActivity throws 404 when organization mismatch', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValue({
      alertId: 'a1',
      organizationId: 'other-org',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
    } as AlertDdbRecord);
    await expect(repo.addNoteActivity('a1', 'org-1', 'hello', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('addNoteActivity uses SYSTEM when performedBy is blank and returns newest activity', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValue({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
    } as AlertDdbRecord);

    const put = jest.spyOn(repo as unknown as { put: jest.Mock }, 'put').mockResolvedValue(undefined);
    jest.spyOn(repo, 'queryAlertActivities').mockResolvedValue([
      {
        activityType: 'NOTE_ADDED',
        performedBy: 'SYSTEM',
        activityComment: 'hello',
      } as never,
    ]);

    const out = await repo.addNoteActivity('a1', 'org-1', 'hello', '   ');

    expect(put).toHaveBeenCalledTimes(1);
    expect(out).toEqual(expect.objectContaining({ performedBy: 'SYSTEM' }));
  });

  it('addNoteActivity throws when activity cannot be read after insert', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValue({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
    } as AlertDdbRecord);

    jest.spyOn(repo as unknown as { put: jest.Mock }, 'put').mockResolvedValue(undefined);
    jest.spyOn(repo, 'queryAlertActivities').mockResolvedValue([]);

    await expect(repo.addNoteActivity('a1', 'org-1', 'hello', 'user-1')).rejects.toThrow(
      'Activity not found after insert',
    );
  });
});
