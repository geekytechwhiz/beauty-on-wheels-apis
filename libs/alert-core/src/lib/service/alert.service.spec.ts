import type { Logger } from '@api-hub/logger';

import type { AlertActivity } from '../models/domain/alert-activity.model';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { CreateAlertPayload } from '../models/api/create-alert.types';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertRepository } from '../repositories/alert-repository';
import { encodeTeamMergeListCursor } from '../utils/alert.utils';
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
    gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.UNASSIGNED),
    gsi1sk: AlertKeyBuilder.buildGsi1Sk('2026-01-15T10:00:00.000Z'),
    gsi3pk: 'PAT#pat-1',
    gsi3sk: 'TS#2026-01-15T10:00:00.000Z',
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
    alertState: ALERT_STATE.UNASSIGNED,
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
      | 'hydrateAlertIdsOrdered'
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
      hydrateAlertIdsOrdered: jest.fn().mockResolvedValue([]),
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

    it('merges UNASSIGNED + ASSIGNED org pages for TEAM queue when state and assignment are unset', async () => {
      const unassigned = minimalRecord({ alertId: 'u-1' });
      const assigned = minimalRecord({
        alertId: 'a-1',
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
      });
      repo.queryOrgAlertsPage.mockImplementation(async (_org, opts) => {
        if (opts.state === ALERT_STATE.UNASSIGNED) return { items: [unassigned] };
        return { items: [assigned] };
      });

      const result = await service.listAlerts({ ...baseListParams(), queue: 'TEAM' });

      expect(result.items.length).toBe(2);
      expect(repo.queryOrgAlertsPage).toHaveBeenCalledTimes(2);
      expect(repo.queryOrgAlertsPage).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          state: ALERT_STATE.UNASSIGNED,
          unassignedOnly: false,
          limit: 50,
        }),
      );
      expect(repo.queryOrgAlertsPage).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          state: ALERT_STATE.ASSIGNED,
          unassignedOnly: false,
          limit: 50,
        }),
      );
      const ids = result.items.map((a) => a.alertId);
      expect(ids).toContain('u-1');
      expect(ids).toContain('a-1');
    });

    it('queries org page once for TEAM when assignment is UNASSIGNED', async () => {
      const row = minimalRecord();
      repo.queryOrgAlertsPage.mockResolvedValue({ items: [row] });

      await service.listAlerts({ ...baseListParams(), queue: 'TEAM', assignment: ALERT_STATE.UNASSIGNED });

      expect(repo.queryOrgAlertsPage).toHaveBeenCalledTimes(1);
      expect(repo.queryOrgAlertsPage).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          state: ALERT_STATE.UNASSIGNED,
          unassignedOnly: true,
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

    it('filters TEAM merge results by priority', async () => {
      const hi = minimalRecord({
        alertId: 'b',
        priority: 'P1',
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
        triggerTimestamp: '2026-01-16T10:00:00.000Z',
      });
      const lo = minimalRecord({ alertId: 'a', priority: 'P2', triggerTimestamp: '2026-01-15T10:00:00.000Z' });
      repo.queryOrgAlertsPage.mockImplementation(async (_org, opts) => {
        if (opts.state === ALERT_STATE.UNASSIGNED) return { items: [lo] };
        return { items: [hi] };
      });

      const result = await service.listAlerts({
        ...baseListParams(),
        queue: 'TEAM',
        priority: 'P1',
      });

      expect(result.items.map((a) => a.alertId)).toEqual(['b']);
    });

    it('includes merge nextToken when more work remains on either branch', async () => {
      const lekU = { pk: 'u', sk: '1' };
      const lekA = { pk: 'a', sk: '2' };
      repo.queryOrgAlertsPage.mockImplementation(async (_org, opts) => {
        if (opts.state === ALERT_STATE.UNASSIGNED) {
          return {
            items: [minimalRecord({ alertId: 'u1', triggerTimestamp: '2026-01-10T10:00:00.000Z' })],
            lastEvaluatedKey: lekU,
          };
        }
        return {
          items: [
            minimalRecord({
              alertId: 'a1',
              alertState: ALERT_STATE.ASSIGNED,
              assignedToUserId: 'user-1',
              gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
              triggerTimestamp: '2026-01-20T10:00:00.000Z',
            }),
          ],
          lastEvaluatedKey: lekA,
        };
      });

      const result = await service.listAlerts({ ...baseListParams(), queue: 'TEAM', limit: 1 });

      expect(result.items.map((a) => a.alertId)).toEqual(['a1']);
      expect(result.nextToken).toBeDefined();
      const parsed = JSON.parse(Buffer.from(result.nextToken!, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      expect(parsed.__teamMergeV1).toBe(1);
      expect(parsed.nU).toEqual(lekU);
      expect(parsed.nA).toEqual(lekA);
      expect(parsed.tailU).toEqual(['u1']);
    });

    it('rejects legacy single-stream nextToken for default TEAM merge', async () => {
      const lek = { gsi1pk: 'ORG#org-1#STATE#UNASSIGNED', gsi1sk: 'TS#x' };
      const legacy = Buffer.from(JSON.stringify(lek), 'utf8').toString('base64url');
      await expect(service.listAlerts({ ...baseListParams(), queue: 'TEAM', nextToken: legacy })).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects merge nextToken when TEAM uses assignment filter', async () => {
      const token = encodeTeamMergeListCursor({ __teamMergeV1: 1, nU: null, nA: null });
      await expect(
        service.listAlerts({
          ...baseListParams(),
          queue: 'TEAM',
          assignment: ALERT_STATE.UNASSIGNED,
          nextToken: token,
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });

    it('throws 400 for invalid nextToken', async () => {
      await expect(
        service.listAlerts({ ...baseListParams(), queue: 'TEAM', nextToken: '%%%' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });
  });
});
