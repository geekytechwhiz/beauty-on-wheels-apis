import { ACTIVITY_TYPE_NOTE_ADDED, ALERT_METADATA_SK } from '../constants/alert.constants';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import { DuplicateEventError } from '../errors/duplicate-event.error';
import type { CreateAlertRequest } from '../models/api/create-alert.request';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertRepository } from './alert-repository';

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
  });

  describe('queryPatientAlertsPage', () => {
    it('hydrates GSI rows via batchGet', async () => {
      const hydrated: AlertDdbRecord = {
        alertId: 'hid-1',
        organizationId: 'org-1',
        patientId: 'pat-1',
        pk: 'ALERT#hid-1',
        sk: ALERT_METADATA_SK,
      } as AlertDdbRecord;

      jest
        .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
        .mockResolvedValue({
          items: [{ alertId: 'hid-1' }],
          lastEvaluatedKey: { k: 'cont' },
        });

      jest.spyOn(repo as unknown as { batchGet: jest.Mock }, 'batchGet').mockResolvedValue([hydrated]);

      const page = await repo.queryPatientAlertsPage('pat-1', { limit: 10 });

      expect(page.items).toEqual([hydrated]);
      expect(page.lastEvaluatedKey).toEqual({ k: 'cont' });
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
});
