import type { Logger } from '@api-hub/logger';

import type { AlertActivity } from '../models/domain/alert-activity.model';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import type { CreateAlertPayload } from '../models/api/create-alert.types';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertRepository } from '../repositories/alert-repository';
import { DuplicateEventError } from '../errors/duplicate-event.error';
import { AlertService } from './alert.service';

const EPOCH_2026_01_15_T10 = Date.parse('2026-01-15T10:00:00.000Z');
const EPOCH_2026_01_15_T11 = Date.parse('2026-01-15T11:00:00.000Z');
const EPOCH_2026_01_15_T12 = Date.parse('2026-01-15T12:00:00.000Z');
const EPOCH_2026_01_15_T10_01 = Date.parse('2026-01-15T10:00:01.000Z');

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
  const trig = EPOCH_2026_01_15_T10;
  const created = EPOCH_2026_01_15_T10_01;
  return {
    pk: `ALERT#${alertId}`,
    sk: 'METADATA',
    entityType: 'ALERT',
    gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.UNASSIGNED),
    gsi1sk: AlertKeyBuilder.buildGsi1Sk(created),
    gsi3pk: 'PAT#pat-1',
    gsi3sk: AlertKeyBuilder.toGsi3Sk(created),
    gsi4pk: AlertKeyBuilder.buildGsi4Pk('org-1'),
    gsi4sk: AlertKeyBuilder.buildGsi4Sk(created, alertId),
    gsi5pk: AlertKeyBuilder.toSlaPartitionKey(EPOCH_2026_01_15_T12),
    gsi5sk: AlertKeyBuilder.toSlaSortKey(EPOCH_2026_01_15_T12, alertId),
    alertId,
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: trig,
    triggerSummary: 'No reading',
    evidencePayload: {},
    priority: 'P2',
    alertState: ALERT_STATE.UNASSIGNED,
    groupingKey: 'g1',
    assignSlaMinutes: 60,
    resolveSlaMinutes: 240,
    assignSlaDueAt: EPOCH_2026_01_15_T11,
    resolveSlaDueAt: EPOCH_2026_01_15_T12,
    slaBreachIndicator: false,
    createdAt: EPOCH_2026_01_15_T10_01,
    updatedAt: EPOCH_2026_01_15_T10_01,
    statusUpdatedAt: EPOCH_2026_01_15_T10_01,
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
      | 'getAlertsById'
      | 'queryAlertActivities'
      | 'queryPatientAlertsPage'
      | 'queryOrgAlertsPage'
      | 'queryOrgAlertsGsi4Page'
      | 'queryUserAlertsPage'
      | 'updateAlertsTransaction'
    >
  >;
  let service: AlertService;
  let log: ReturnType<typeof mockLogger>;

  beforeEach(() => {
    log = mockLogger();
    repo = {
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertById: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
    };
    service = new AlertService(repo as unknown as AlertRepository, log);
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
      expect(log.info).toHaveBeenCalled();
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
      expect(log.warn).toHaveBeenCalled();
    });

    it('replays idempotently after DuplicateEventError when row appears', async () => {
      const record = minimalRecord();
      repo.resolveInputEventId.mockResolvedValueOnce('missing');
      repo.createAlert.mockRejectedValueOnce(new DuplicateEventError('evt-dup-err'));
      repo.resolveInputEventId.mockResolvedValueOnce(record);

      const result = await service.createAlert(createPayload({ inputEventId: 'evt-dup-err' }));

      expect(result.duplicate).toBe(true);
      expect(result.record).toBe(record);
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
          activityTimestamp: EPOCH_2026_01_15_T10,
          performedBy: 'SYSTEM',
        } as AlertActivity,
      ];
      repo.queryAlertActivities.mockResolvedValue(activities);

      const out = await service.listAlertActivity('aid', 'org-1');
      expect(out).toBe(activities);
      expect(repo.queryAlertActivities).toHaveBeenCalledWith('aid', undefined);
    });

    it('passes notesOnly to repository', async () => {
      repo.queryAlertActivities.mockResolvedValue([]);
      await service.listAlertActivity('aid', 'org-1', { notesOnly: true });
      expect(repo.queryAlertActivities).toHaveBeenCalledWith('aid', { notesOnly: true });
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

    it('queries GSI4 for default TEAM in a single call (no default alertState filter)', async () => {
      const unassigned = minimalRecord({ alertId: 'u-1' });
      const assigned = minimalRecord({
        alertId: 'a-1',
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
      });
      repo.queryOrgAlertsGsi4Page.mockResolvedValue({ items: [unassigned, assigned] });

      const result = await service.listAlerts({ ...baseListParams(), queue: 'TEAM' });

      expect(result.items.length).toBe(2);
      expect(repo.queryOrgAlertsGsi4Page).toHaveBeenCalledTimes(1);
      expect(repo.queryOrgAlertsGsi4Page).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          limit: 50,
        }),
      );
      expect(repo.queryOrgAlertsPage).not.toHaveBeenCalled();
      const ids = result.items.map((a) => a.alertId);
      expect(ids).toContain('u-1');
      expect(ids).toContain('a-1');
    });

    it('passes assignment (assignee user id) to GSI4 for TEAM', async () => {
      repo.queryOrgAlertsGsi4Page.mockResolvedValue({ items: [] });

      await service.listAlerts({
        ...baseListParams(),
        queue: 'TEAM',
        assignment: '5fa85f64-5717-4562-b3fc-2c963f66afa8',
      });

      expect(repo.queryOrgAlertsGsi4Page).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          assignedToUserId: '5fa85f64-5717-4562-b3fc-2c963f66afa8',
        }),
      );
    });

    it('passes workflow state and assignment filters independently for TEAM', async () => {
      repo.queryOrgAlertsGsi4Page.mockResolvedValue({ items: [] });

      await service.listAlerts({
        ...baseListParams(),
        queue: 'TEAM',
        state: ALERT_STATE.IN_PROGRESS,
        assignment: 'user-1',
      });

      expect(repo.queryOrgAlertsGsi4Page).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          state: ALERT_STATE.IN_PROGRESS,
          assignedToUserId: 'user-1',
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

    it('passes priority to GSI4 query for TEAM', async () => {
      const hi = minimalRecord({
        alertId: 'b',
        priority: 'P1',
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
        triggerTimestamp: Date.parse('2026-01-16T10:00:00.000Z'),
      });
      repo.queryOrgAlertsGsi4Page.mockResolvedValue({ items: [hi] });

      const result = await service.listAlerts({
        ...baseListParams(),
        queue: 'TEAM',
        priority: 'P1',
      });

      expect(repo.queryOrgAlertsGsi4Page).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          priority: 'P1',
        }),
      );
      expect(result.items.map((a) => a.alertId)).toEqual(['b']);
    });

    it('returns Dynamo LastEvaluatedKey as nextToken for TEAM', async () => {
      const lek = { gsi4pk: 'ORG#org-1', gsi4sk: 'TS#00001736938200000#x', pk: 'ALERT#a1', sk: 'METADATA' };
      repo.queryOrgAlertsGsi4Page.mockResolvedValue({
        items: [
          minimalRecord({
            alertId: 'a1',
            alertState: ALERT_STATE.ASSIGNED,
            assignedToUserId: 'user-1',
            gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.ASSIGNED),
            triggerTimestamp: Date.parse('2026-01-20T10:00:00.000Z'),
          }),
        ],
        lastEvaluatedKey: lek,
      });

      const result = await service.listAlerts({ ...baseListParams(), queue: 'TEAM', limit: 1 });

      expect(result.items.map((a) => a.alertId)).toEqual(['a1']);
      expect(result.nextToken).toBeDefined();
      const parsed = JSON.parse(Buffer.from(result.nextToken!, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      expect(parsed.gsi4pk).toBe('ORG#org-1');
    });

    it('throws 400 for invalid nextToken', async () => {
      await expect(
        service.listAlerts({ ...baseListParams(), queue: 'TEAM', nextToken: '%%%' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });

    it('delegates PATIENT, MY, and TEAM and maps nextToken where applicable', async () => {
      const patRow = minimalRecord({ alertId: 'p1' });
      const teamRow = minimalRecord({ alertId: 't1' });
      const myRow = minimalRecord({ alertId: 'm1' });
      repo.queryPatientAlertsPage.mockResolvedValue({
        items: [patRow],
        lastEvaluatedKey: { k: 1 },
      });
      repo.queryOrgAlertsGsi4Page.mockResolvedValue({
        items: [teamRow],
        lastEvaluatedKey: { k: 2 },
      });
      repo.queryUserAlertsPage.mockResolvedValue({
        items: [myRow],
        lastEvaluatedKey: undefined,
      });

      const patient = await service.listAlerts({
        organizationId: 'org-1',
        queue: 'PATIENT',
        patientId: 'pat-1',
        limit: 2,
      });
      expect(patient.items[0].alertId).toBe('p1');
      expect(patient).toHaveProperty('nextToken');

      const my = await service.listAlerts({
        organizationId: 'org-1',
        queue: 'MY',
        actorUserId: 'u1',
        limit: 2,
      });
      expect(my.items[0].alertId).toBe('m1');
      expect(my).not.toHaveProperty('nextToken');

      const team = await service.listAlerts({
        organizationId: 'org-1',
        queue: 'TEAM',
        limit: 2,
      });
      expect(team.items[0].alertId).toBe('t1');
      expect(team).toHaveProperty('nextToken');
    });
  });

  describe('applyAssignment', () => {
    it('updates all alerts in one transaction (ASSIGN)', async () => {
      const a1 = minimalRecord({ alertId: 'a1', pk: 'ALERT#a1' });
      const a2 = minimalRecord({ alertId: 'a2', pk: 'ALERT#a2' });
      repo.getAlertsById.mockResolvedValue(new Map([
        ['a1', a1],
        ['a2', a2],
      ]));
      repo.getAlertById.mockResolvedValue(a1);

      const result = await service.applyAssignment('org-1', {
        alertIds: ['a1', 'a2'],
        action: 'ASSIGN',
        assignToUserId: 'user-9',
        assigneeDisplayName: 'User Nine',
        performedByUserId: 'actor-1',
      });

      expect(result).toEqual({});
      expect(repo.updateAlertsTransaction).toHaveBeenCalledTimes(1);
      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            existing: a1,
            patch: { alertState: ALERT_STATE.ASSIGNED, assignedToUserId: 'user-9', assignedToDisplayName: 'User Nine' },
            activityItems: expect.any(Array),
            performedByUserId: 'actor-1',
          }),
          expect.objectContaining({
            existing: a2,
            patch: { alertState: ALERT_STATE.ASSIGNED, assignedToUserId: 'user-9', assignedToDisplayName: 'User Nine' },
            activityItems: expect.any(Array),
            performedByUserId: 'actor-1',
          }),
        ]),
      );
    });

    it('returns empty result for single-select', async () => {
      const a1 = minimalRecord({ alertId: 'a1', pk: 'ALERT#a1' });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));
      repo.getAlertById.mockResolvedValue(a1);

      const result = await service.applyAssignment('org-1', {
        alertIds: ['a1'],
        action: 'UNASSIGN',
      });

      expect(result).toEqual({});
      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith([
        expect.objectContaining({
          existing: a1,
          patch: { assignedToUserId: null, assignedToDisplayName: null },
          activityItems: expect.any(Array),
          performedByUserId: 'SYSTEM',
        }),
      ]);
    });

    it('ASSIGN from IN_PROGRESS retains state and only updates assignee', async () => {
      const a1 = minimalRecord({
        alertId: 'a1',
        pk: 'ALERT#a1',
        alertState: ALERT_STATE.IN_PROGRESS,
        assignedToUserId: 'user-old',
        assignedToDisplayName: 'User Old',
      });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));

      await service.applyAssignment('org-1', {
        alertIds: ['a1'],
        action: 'ASSIGN',
        assignToUserId: 'user-new',
        assigneeDisplayName: 'User New',
      });

      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith([
        expect.objectContaining({
          existing: a1,
          patch: { assignedToUserId: 'user-new', assignedToDisplayName: 'User New' },
        }),
      ]);
    });

    it('REASSIGN from WAITING retains state and only updates assignee', async () => {
      const a1 = minimalRecord({
        alertId: 'a1',
        pk: 'ALERT#a1',
        alertState: ALERT_STATE.WAITING,
        assignedToUserId: 'user-old',
        assignedToDisplayName: 'User Old',
      });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));

      await service.applyAssignment('org-1', {
        alertIds: ['a1'],
        action: 'REASSIGN',
        assignToUserId: 'user-new',
        assigneeDisplayName: 'User New',
      });

      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith([
        expect.objectContaining({
          existing: a1,
          patch: { assignedToUserId: 'user-new', assignedToDisplayName: 'User New' },
        }),
      ]);
    });

    it('ASSIGN_TO_SELF from IN_PROGRESS retains state', async () => {
      const a1 = minimalRecord({
        alertId: 'a1',
        pk: 'ALERT#a1',
        alertState: ALERT_STATE.IN_PROGRESS,
        assignedToUserId: 'user-old',
        assignedToDisplayName: 'User Old',
      });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));

      await service.applyAssignment('org-1', {
        alertIds: ['a1'],
        action: 'ASSIGN_TO_SELF',
        assignToUserId: 'user-self',
        assigneeDisplayName: 'User Self',
      });

      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith([
        expect.objectContaining({
          existing: a1,
          patch: { assignedToUserId: 'user-self', assignedToDisplayName: 'User Self' },
        }),
      ]);
    });

    it('UNASSIGN from IN_PROGRESS retains state and clears assignee', async () => {
      const a1 = minimalRecord({
        alertId: 'a1',
        pk: 'ALERT#a1',
        alertState: ALERT_STATE.IN_PROGRESS,
        assignedToUserId: 'user-old',
        assignedToDisplayName: 'User Old',
      });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));

      await service.applyAssignment('org-1', {
        alertIds: ['a1'],
        action: 'UNASSIGN',
      });

      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith([
        expect.objectContaining({
          existing: a1,
          patch: { assignedToUserId: null, assignedToDisplayName: null },
        }),
      ]);
    });

    it('fails for terminal state and does not write', async () => {
      const a1 = minimalRecord({ alertId: 'a1', pk: 'ALERT#a1', alertState: ALERT_STATE.RESOLVED });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));

      await expect(
        service.applyAssignment('org-1', { alertIds: ['a1'], action: 'UNASSIGN' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'TERMINAL_STATE' });

      expect(repo.updateAlertsTransaction).not.toHaveBeenCalled();
    });

    it('throws 422 when assignToUserId missing for ASSIGN', async () => {
      await expect(
        service.applyAssignment('org-1', {
          action: 'ASSIGN',
          alertIds: ['a1'],
          assigneeDisplayName: 'X',
        } as never),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(repo.getAlertsById).not.toHaveBeenCalled();
    });

    it('throws 422 when assigneeDisplayName missing for ASSIGN_TO_SELF', async () => {
      await expect(
        service.applyAssignment('org-1', {
          action: 'ASSIGN_TO_SELF',
          alertIds: ['a1'],
          assignToUserId: 'u1',
        } as never),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(repo.getAlertsById).not.toHaveBeenCalled();
    });
  });

  describe('applyPriority', () => {
    it('updates all alerts in one transaction', async () => {
      const a1 = minimalRecord({ alertId: 'a1', pk: 'ALERT#a1' });
      const a2 = minimalRecord({ alertId: 'a2', pk: 'ALERT#a2' });
      repo.getAlertsById.mockResolvedValue(new Map([
        ['a1', a1],
        ['a2', a2],
      ]));
      repo.getAlertById.mockResolvedValue({ ...a1, priority: 'P1' } as any);

      const result = await service.applyPriority('org-1', {
        alertIds: ['a1', 'a2'],
        priority: 'P1',
        performedByUserId: 'actor-1',
      });

      expect(result).toEqual({});
      expect(repo.updateAlertsTransaction).toHaveBeenCalledTimes(1);
      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ existing: a1, patch: { priority: 'P1' } }),
          expect.objectContaining({ existing: a2, patch: { priority: 'P1' } }),
        ]),
      );
    });

    it('returns empty result for single-select', async () => {
      const a1 = minimalRecord({ alertId: 'a1', pk: 'ALERT#a1' });
      repo.getAlertsById.mockResolvedValue(new Map([['a1', a1]]));
      repo.getAlertById.mockResolvedValue({ ...a1, priority: 'P0' } as any);

      const result = await service.applyPriority('org-1', {
        alertIds: ['a1'],
        priority: 'P0',
      });

      expect(result).toEqual({});
      expect(repo.updateAlertsTransaction).toHaveBeenCalledWith([
        expect.objectContaining({ patch: { priority: 'P0' } }),
      ]);
    });
  });

  describe('addNote', () => {
    it('throws 404 when alert not found', async () => {
      repo.getAlertById.mockResolvedValue(null);

      await expect(service.addNote('a1', 'org-1', 'hello')).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  describe('applyWorkflow', () => {
    it('processes bulk with mixed states per-alert (no heterogeneous bulk error)', async () => {
      const row1 = minimalRecord({ alertId: 'a1', alertState: ALERT_STATE.ASSIGNED });
      const row2 = minimalRecord({ alertId: 'a2', alertState: ALERT_STATE.UNASSIGNED });
      repo.getAlertById.mockImplementation(async (id: string) => {
        if (id === 'a1') return row1;
        if (id === 'a2') return row2;
        return null;
      });
      (repo as any).updateAlert = jest.fn().mockResolvedValue(row1);

      const out = await service.applyWorkflow('org-1', {
        alertIds: ['a1', 'a2'],
        action: 'START_WORK' as any,
        performedByDisplayName: 'User',
      } as any);

      expect(out.succeeded).toEqual(['a1']);
      expect(out.failed).toHaveLength(1);
      expect(out.failed[0]).toMatchObject({ alertId: 'a2', code: 'ILLEGAL_TRANSITION' });
    });

    it('maps ILLEGAL_TRANSITION into failed[] and does not throw', async () => {
      const row = minimalRecord({ alertId: 'a1', alertState: ALERT_STATE.UNASSIGNED });
      repo.getAlertById.mockResolvedValue(row);
      (repo as any).updateAlert = jest.fn();

      const out = await service.applyWorkflow('org-1', {
        alertIds: ['a1'],
        action: 'START_WORK' as any, // invalid from UNASSIGNED
        performedByDisplayName: 'User',
      } as any);

      expect(out.succeeded).toEqual([]);
      expect(out.failed[0]).toMatchObject({ alertId: 'a1', code: 'ILLEGAL_TRANSITION' });
    });

    it('records NOT_FOUND when update returns null', async () => {
      const row = minimalRecord({ alertId: 'a1', alertState: ALERT_STATE.ASSIGNED });
      repo.getAlertById.mockResolvedValue(row);
      (repo as any).updateAlert = jest.fn().mockResolvedValue(null);

      const out = await service.applyWorkflow('org-1', {
        alertIds: ['a1'],
        action: 'START_WORK' as any,
        performedByDisplayName: 'User',
      } as any);

      expect(out.succeeded).toEqual([]);
      expect(out.failed[0]).toMatchObject({ alertId: 'a1', code: 'NOT_FOUND' });
    });
  });
});
