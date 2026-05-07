import { AlertRepository } from './alert-repository';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import { ALERT_STATE } from '../models/types/alert-state.type';
import { ALERT_METADATA_SK } from '../constants/alert.constants';
import { DuplicateEventError } from '../errors/duplicate-event.error';

const TABLE = 'test-alert-table';

describe('AlertRepository (coverage)', () => {
  let repo: AlertRepository;

  beforeEach(() => {
    process.env.ALERT_TABLE = TABLE;
    repo = new AlertRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ALERT_TABLE;
  });

  it('getAlertsById batches >100 ids and returns map', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `a-${i}`);
    const batchGet = jest
      .spyOn(repo as unknown as { batchGet: jest.Mock }, 'batchGet')
      .mockImplementation(async ({ RequestItems }: any) => {
        const keys = RequestItems[TABLE].Keys as Array<{ pk: string; sk: string }>;
        // return only the first key as an item (enough to cover mapping)
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

  it('queryAlertActivities covers both notesOnly branches', async () => {
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
      } as any),
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
      } as any),
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

    // also cover default state + no unassigned filter branch
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
      // invalid date strings should be ignored (exercise NaN branches)
      dateFrom: 'not-a-date',
      dateTo: 'also-not-a-date',
    } as any);

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
    await expect(repo.updateAlert('a1', { priority: 'P1' } as any)).resolves.toBeNull();
  });

  it('updateAlert uses update when no activityItems', async () => {
    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
    } as any);
    const update = jest.spyOn(repo as unknown as { update: jest.Mock }, 'update').mockResolvedValue(undefined);
    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
      priority: 'P1',
    } as any);

    const out = await repo.updateAlert('a1', { priority: 'P1' } as any, {
      activityItems: [null as any, 123 as any, 'nope' as any],
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
    } as any);

    const tw = jest.spyOn(repo as unknown as { transactWrite: jest.Mock }, 'transactWrite').mockResolvedValue(undefined);
    const update = jest.spyOn(repo as unknown as { update: jest.Mock }, 'update').mockResolvedValue(undefined);

    jest.spyOn(repo, 'getAlertById').mockResolvedValueOnce({
      alertId: 'a1',
      organizationId: 'org-1',
      pk: 'ALERT#a1',
      sk: ALERT_METADATA_SK,
      priority: 'P2',
    } as any);

    const out = await repo.updateAlert('a1', { priority: 'P2' } as any, {
      activityItems: [{ pk: 'x', sk: 'y' }],
    });

    expect(update).not.toHaveBeenCalled();
    expect(tw).toHaveBeenCalledTimes(1);
    const items = tw.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2); // Update + Put
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
        existing: { alertId: 'a1', organizationId: 'org-1', pk: 'ALERT#a1', sk: ALERT_METADATA_SK } as any,
        patch: { priority: 'P1' } as any,
        activityItems: [{ pk: 'A', sk: '1' }, null as any, 123 as any] as any,
        performedByUserId: 'user-1',
      },
      {
        existing: { alertId: 'a2', organizationId: 'org-1', pk: 'ALERT#a2', sk: ALERT_METADATA_SK } as any,
        patch: { priority: 'P2' } as any,
      },
    ]);

    expect(tw).toHaveBeenCalledTimes(1);
    const items = tw.mock.calls[0][0].TransactItems;
    // 2 updates + 1 put (only valid object)
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
    } as any);
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
    } as any);

    const put = jest.spyOn(repo as unknown as { put: jest.Mock }, 'put').mockResolvedValue(undefined);
    jest.spyOn(repo, 'queryAlertActivities').mockResolvedValue([
      {
        activityType: 'NOTE_ADDED',
        performedBy: 'SYSTEM',
        activityComment: 'hello',
      } as any,
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
    } as any);

    jest.spyOn(repo as unknown as { put: jest.Mock }, 'put').mockResolvedValue(undefined);
    jest.spyOn(repo, 'queryAlertActivities').mockResolvedValue([]);

    await expect(repo.addNoteActivity('a1', 'org-1', 'hello', 'user-1')).rejects.toThrow(
      'Activity not found after insert',
    );
  });
});

