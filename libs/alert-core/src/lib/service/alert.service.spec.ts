import type { Logger } from '@api-hub/logger';

import type { AlertActivity } from '../models/domain/alert-activity.model';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { CreateAlertPayload } from '../models/api/create-alert.types';
import { AlertRepository } from '../repositories/alert-repository';
import { AlertService } from './alert.service';

function mockLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as Logger;
}

function minimalRecord(overrides: Partial<AlertDdbRecord> = {}): AlertDdbRecord {
  const alertId = '11111111-1111-4111-8111-111111111111';
  return {
    TableName: 't',
    pk: `ALERT#${alertId}`,
    sk: 'METADATA',
    entityType: 'ALERT',
    gsi1pk: 'ORG#org-1',
    gsi1sk: 'STATE#UNASSIGNED#',
    gsi3pk: 'PAT#pat-1',
    gsi3sk: 'TS#2026-01-15T10:00:00.000Z',
    gsi4pk: 'GROUP#g1',
    gsi4sk: 'TS#2026-01-15T10:00:00.000Z',
    gsi5pk: 'SLA#2026-01-15',
    gsi5sk: 'SLA#2026-01-15T10:00:00.000Z',
    alertId,
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: '2026-01-15T10:00:00.000Z',
    triggerSummary: 'No reading',
    evidencePayload: {},
    priority: 'P2',
    alertState: 'UNASSIGNED',
    groupingKey: 'g1',
    assignSlaMinutes: 60,
    resolveSlaMinutes: 240,
    assignSlaDueAt: '2026-01-15T11:00:00.000Z',
    resolveSlaDueAt: '2026-01-15T12:00:00.000Z',
    slaBreachIndicator: false,
    createdAt: '2026-01-15T10:00:01.000Z',
    updatedAt: '2026-01-15T10:00:01.000Z',
    statusUpdatedAt: '2026-01-15T10:00:01.000Z',
    ...overrides,
  } as AlertDdbRecord;
}

function createPayload(overrides: Partial<CreateAlertPayload> = {}): CreateAlertPayload {
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

function baseListParams() {
  return {
    organizationId: 'org-1',
    queue: 'TEAM' as const,
    limit: 50,
  };
}

describe('AlertService', () => {
  let repo: jest.Mocked<
    Pick<
      AlertRepository,
      | 'resolveInputEventId'
      | 'createAlert'
      | 'getAlertById'
      | 'queryAlertActivities'
      | 'queryPatientAlertsPage'
      | 'queryOrgAlertsPage'
      | 'queryUserAlertsPage'
    >
  >;
  let service: AlertService;

  beforeEach(() => {
    repo = {
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryUserAlertsPage: jest.fn(),
    };
    service = new AlertService(repo as unknown as AlertRepository, mockLogger());
  });

  describe('createAlert', () => {
    it('creates when idempotency resolves missing and returns duplicate false', async () => {
      const record = minimalRecord();
      repo.resolveInputEventId.mockResolvedValue('missing');
      repo.createAlert.mockResolvedValue(record);

      const payload = createPayload({ inputEventId: 'evt-new' });
      const result = await service.createAlert(payload);

      expect(result.duplicate).toBe(false);
      expect(result.record).toBe(record);
      expect(repo.resolveInputEventId).toHaveBeenCalledWith('evt-new', 'org-1');
      expect(repo.createAlert).toHaveBeenCalledTimes(1);
      const keyed = repo.createAlert.mock.calls[0][0];
      expect(keyed.inputEventId).toBe('evt-new');
      expect(keyed.triggerSummary).toBeTruthy();
    });

    it('returns duplicate true when idempotency resolves an existing record', async () => {
      const record = minimalRecord();
      repo.resolveInputEventId.mockResolvedValue(record);

      const result = await service.createAlert(createPayload({ inputEventId: 'evt-dup' }));

      expect(result.duplicate).toBe(true);
      expect(result.record).toBe(record);
      expect(repo.createAlert).not.toHaveBeenCalled();
    });

    it('throws 409 when idempotency key belongs to another organization', async () => {
      repo.resolveInputEventId.mockResolvedValue('foreign_org');

      await expect(service.createAlert(createPayload({ inputEventId: 'evt-x' }))).rejects.toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_IN_USE',
      });
      expect(repo.createAlert).not.toHaveBeenCalled();
    });

    it('replays idempotently after TransactionCanceledException when row appears', async () => {
      const record = minimalRecord();
      repo.resolveInputEventId.mockResolvedValueOnce('missing');
      repo.createAlert.mockRejectedValueOnce({ name: 'TransactionCanceledException' });
      repo.resolveInputEventId.mockResolvedValueOnce(record);

      const result = await service.createAlert(createPayload({ inputEventId: 'evt-race' }));

      expect(result.duplicate).toBe(true);
      expect(result.record).toBe(record);
      expect(repo.createAlert).toHaveBeenCalledTimes(1);
      expect(repo.resolveInputEventId).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAlert', () => {
    it('returns null when repository has no row', async () => {
      repo.getAlertById.mockResolvedValue(null);
      expect(await service.getAlert('a', 'org-1')).toBeNull();
    });

    it('returns null when organization does not match', async () => {
      repo.getAlertById.mockResolvedValue(minimalRecord({ organizationId: 'other' }));
      expect(await service.getAlert('a', 'org-1')).toBeNull();
    });

    it('returns row when organization matches (including ORG# normalization)', async () => {
      const row = minimalRecord({ organizationId: 'ORG#org-1' });
      repo.getAlertById.mockResolvedValue(row);
      expect(await service.getAlert(row.alertId, 'org-1')).toBe(row);
    });
  });

  describe('listAlertActivity', () => {
    it('delegates to repository', async () => {
      const activities: AlertActivity[] = [
        {
          activityId: 'act-1',
          alertId: 'aid',
          activityType: 'ALERT_CREATED',
          activityTimestamp: '2026-01-15T10:00:00.000Z',
          performedBy: 'SYSTEM',
        } as AlertActivity,
      ];
      repo.queryAlertActivities.mockResolvedValue(activities);

      const out = await service.listAlertActivity('aid', 'org-1');
      expect(out).toBe(activities);
      expect(repo.queryAlertActivities).toHaveBeenCalledWith('aid');
    });
  });

  describe('listAlerts', () => {
    it('throws 400 when MY queue has no actor user id', async () => {
      await expect(
        service.listAlerts({
          ...baseListParams(),
          queue: 'MY',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.queryUserAlertsPage).not.toHaveBeenCalled();
    });

    it('queries org page for TEAM queue with default UNASSIGNED state', async () => {
      const row = minimalRecord();
      repo.queryOrgAlertsPage.mockResolvedValue({ items: [row] });

      const result = await service.listAlerts({ ...baseListParams(), queue: 'TEAM' });

      expect(result.items).toEqual([row]);
      expect(repo.queryOrgAlertsPage).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          state: 'UNASSIGNED',
          unassignedOnly: false,
          limit: 50,
        }),
      );
    });

    it('queries patient page for PATIENT queue', async () => {
      const row = minimalRecord({ organizationId: 'org-1' });
      repo.queryPatientAlertsPage.mockResolvedValue({ items: [row] });

      const result = await service.listAlerts({
        ...baseListParams(),
        queue: 'PATIENT',
        patientId: 'pat-1',
      });

      expect(result.items).toEqual([row]);
      expect(repo.queryPatientAlertsPage).toHaveBeenCalledWith(
        'pat-1',
        expect.objectContaining({ limit: 50 }),
      );
      expect(repo.queryOrgAlertsPage).not.toHaveBeenCalled();
    });

    it('filters TEAM results by priority', async () => {
      const hi = minimalRecord({ alertId: '1', priority: 'P1' });
      const lo = minimalRecord({ alertId: '2', priority: 'P2' });
      repo.queryOrgAlertsPage.mockResolvedValue({ items: [hi, lo] });

      const result = await service.listAlerts({
        ...baseListParams(),
        queue: 'TEAM',
        priority: 'P1',
      });

      expect(result.items.map((a) => a.alertId)).toEqual(['1']);
    });

    it('includes nextToken when DynamoDB returns LastEvaluatedKey', async () => {
      const lek = { pk: 'x', sk: 'y' };
      repo.queryOrgAlertsPage.mockResolvedValue({
        items: [minimalRecord()],
        lastEvaluatedKey: lek,
      });

      const result = await service.listAlerts({ ...baseListParams(), queue: 'TEAM' });

      expect(result.nextToken).toBe(Buffer.from(JSON.stringify(lek), 'utf8').toString('base64url'));
    });

    it('throws 400 for invalid nextToken', async () => {
      await expect(
        service.listAlerts({ ...baseListParams(), queue: 'TEAM', nextToken: '%%%' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });
  });
});
