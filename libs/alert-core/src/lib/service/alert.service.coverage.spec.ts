import type { Logger } from '@api-hub/logger';

import { AlertRepository } from '../repositories/alert-repository';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import { ALERT_STATE } from '../models/types/alert-state.type';
import { AlertService } from './alert.service';
import { DuplicateEventError } from '../errors/duplicate-event.error';

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
  return {
    pk: `ALERT#${overrides.alertId ?? 'a1'}`,
    sk: 'METADATA',
    entityType: 'ALERT',
    alertId: overrides.alertId ?? 'a1',
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: Date.now(),
    triggerSummary: 't',
    evidencePayload: {},
    priority: 'P2',
    alertState: ALERT_STATE.UNASSIGNED,
    groupingKey: 'g1',
    assignSlaMinutes: 60,
    resolveSlaMinutes: 240,
    assignSlaDueAt: Date.now(),
    resolveSlaDueAt: Date.now(),
    slaBreachIndicator: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    statusUpdatedAt: Date.now(),
    ...overrides,
  } as AlertDdbRecord;
}

describe('AlertService (coverage)', () => {
  it('createAlert returns duplicate when idempotency resolves an existing record', async () => {
    const existing = minimalRecord({ alertId: 'a-existing' });
    const repo = {
      resolveInputEventId: jest.fn().mockResolvedValue(existing),
      createAlert: jest.fn(),
      getAlertById: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const log = mockLogger();
    const service = new AlertService(repo, log);
    const out = await service.createAlert({
      organizationId: 'org-1',
      inputType: 'MISSED_READING',
      sourceType: 'MONITORING_SERVICE',
      patientId: 'pat-1',
      triggerTimestamp: new Date().toISOString(),
      evidencePayload: {},
      inputEventId: 'evt-1',
    } as any);

    expect(out.duplicate).toBe(true);
    expect(out.record.alertId).toBe('a-existing');
    expect(log.info).toHaveBeenCalled();
    expect(repo.createAlert).not.toHaveBeenCalled();
  });

  it('createAlert throws 409 when idempotency key belongs to another organization', async () => {
    const repo = {
      resolveInputEventId: jest.fn().mockResolvedValue('foreign_org'),
      createAlert: jest.fn(),
      getAlertById: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    await expect(
      service.createAlert({
        organizationId: 'org-1',
        inputType: 'MISSED_READING',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        triggerTimestamp: new Date().toISOString(),
        evidencePayload: {},
        inputEventId: 'evt-x',
      } as any),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_IN_USE' });
  });

  it('createAlert resolves duplicate after TransactionCanceledException', async () => {
    const created = minimalRecord({ alertId: 'a1', inputEventId: 'evt-1' });
    const repo = {
      resolveInputEventId: jest
        .fn()
        .mockResolvedValueOnce('missing')
        .mockResolvedValueOnce(created),
      createAlert: jest.fn().mockRejectedValue({ name: 'TransactionCanceledException' }),
      getAlertById: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const log = mockLogger();
    const service = new AlertService(repo, log);
    const out = await service.createAlert({
      organizationId: 'org-1',
      inputType: 'MISSED_READING',
      sourceType: 'MONITORING_SERVICE',
      patientId: 'pat-1',
      triggerTimestamp: new Date().toISOString(),
      evidencePayload: {},
      inputEventId: 'evt-1',
    } as any);

    expect(out.duplicate).toBe(true);
    expect(out.record.alertId).toBe('a1');
    expect(log.warn).toHaveBeenCalled();
  });

  it('createAlert resolves duplicate after DuplicateEventError', async () => {
    const created = minimalRecord({ alertId: 'a1', inputEventId: 'evt-1' });
    const repo = {
      resolveInputEventId: jest
        .fn()
        .mockResolvedValueOnce('missing')
        .mockResolvedValueOnce(created),
      createAlert: jest.fn().mockRejectedValue(new DuplicateEventError('evt-1')),
      getAlertById: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    const out = await service.createAlert({
      organizationId: 'org-1',
      inputType: 'MISSED_READING',
      sourceType: 'MONITORING_SERVICE',
      patientId: 'pat-1',
      triggerTimestamp: new Date().toISOString(),
      evidencePayload: {},
      inputEventId: 'evt-1',
    } as any);

    expect(out.duplicate).toBe(true);
    expect(out.record.alertId).toBe('a1');
  });

  it('listAlerts throws 400 when MY queue has no actorUserId', async () => {
    const repo = {
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
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    await expect(
      service.listAlerts({
        organizationId: 'org-1',
        queue: 'MY',
      } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('listAlerts delegates to PATIENT / MY / TEAM and returns nextToken when present', async () => {
    const repo = {
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertById: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn().mockResolvedValue({ items: [minimalRecord({ alertId: 'p1' })], lastEvaluatedKey: { k: 1 } }),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn().mockResolvedValue({ items: [minimalRecord({ alertId: 't1' })], lastEvaluatedKey: { k: 2 } }),
      queryUserAlertsPage: jest.fn().mockResolvedValue({ items: [minimalRecord({ alertId: 'm1' })], lastEvaluatedKey: undefined }),
      updateAlertsTransaction: jest.fn(),
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());

    const patient = await service.listAlerts({ organizationId: 'org-1', queue: 'PATIENT', patientId: 'pat-1', limit: 2 } as any);
    expect(patient.items[0].alertId).toBe('p1');
    expect(patient).toHaveProperty('nextToken');

    const my = await service.listAlerts({ organizationId: 'org-1', queue: 'MY', actorUserId: 'u1', limit: 2 } as any);
    expect(my.items[0].alertId).toBe('m1');
    expect(my).not.toHaveProperty('nextToken');

    const team = await service.listAlerts({ organizationId: 'org-1', queue: 'TEAM', limit: 2 } as any);
    expect(team.items[0].alertId).toBe('t1');
    expect(team).toHaveProperty('nextToken');
  });

  it('applyAssignment throws 422 for missing assignToUserId on ASSIGN', async () => {
    const repo = {
      getAlertsById: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    await expect(
      service.applyAssignment('org-1', {
        action: 'ASSIGN',
        alertIds: ['a1'],
        assigneeDisplayName: 'X',
      } as any),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('applyAssignment throws 422 for missing assigneeDisplayName when not UNASSIGN', async () => {
    const repo = {
      getAlertsById: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    await expect(
      service.applyAssignment('org-1', {
        action: 'ASSIGN_TO_SELF',
        alertIds: ['a1'],
        assignToUserId: 'u1',
      } as any),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('addNote throws 404 when alert not found', async () => {
    const repo = {
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertById: jest.fn().mockResolvedValue(null),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      addNoteActivity: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    await expect(service.addNote('a1', 'org-1', 'hello')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('applyWorkflow processes mixed-state bulk per-alert (no heterogeneous error)', async () => {
    const row1 = minimalRecord({ alertId: 'a1', alertState: ALERT_STATE.ASSIGNED });
    const row2 = minimalRecord({ alertId: 'a2', alertState: ALERT_STATE.UNASSIGNED });

    const repo = {
      getAlertById: jest.fn().mockImplementation(async (id: string) => {
        if (id === 'a1') return row1;
        if (id === 'a2') return row2;
        return null;
      }),
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      updateAlert: jest.fn().mockResolvedValue(row1),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    const out = await service.applyWorkflow('org-1', {
      alertIds: ['a1', 'a2'],
      action: 'START_WORK' as any,
      performedByDisplayName: 'User',
    } as any);

    expect(out.succeeded).toEqual(['a1']);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toMatchObject({ alertId: 'a2', code: 'ILLEGAL_TRANSITION' });
  });

  it('applyWorkflow maps ILLEGAL_TRANSITION into failed[] and does not throw', async () => {
    const row = minimalRecord({ alertId: 'a1', alertState: ALERT_STATE.UNASSIGNED });

    const repo = {
      getAlertById: jest.fn().mockResolvedValue(row),
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      updateAlert: jest.fn(),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    const out = await service.applyWorkflow('org-1', {
      alertIds: ['a1'],
      action: 'START_WORK' as any, // invalid from UNASSIGNED
      performedByDisplayName: 'User',
    } as any);

    expect(out.succeeded).toEqual([]);
    expect(out.failed[0]).toMatchObject({ alertId: 'a1', code: 'ILLEGAL_TRANSITION' });
  });

  it('applyWorkflow records NOT_FOUND when update returns null', async () => {
    const row = minimalRecord({ alertId: 'a1', alertState: ALERT_STATE.ASSIGNED });

    const repo = {
      getAlertById: jest.fn().mockResolvedValue(row),
      resolveInputEventId: jest.fn(),
      createAlert: jest.fn(),
      getAlertsById: jest.fn(),
      queryAlertActivities: jest.fn(),
      queryPatientAlertsPage: jest.fn(),
      queryOrgAlertsPage: jest.fn(),
      queryOrgAlertsGsi4Page: jest.fn(),
      queryUserAlertsPage: jest.fn(),
      updateAlertsTransaction: jest.fn(),
      updateAlert: jest.fn().mockResolvedValue(null),
    } as unknown as AlertRepository;

    const service = new AlertService(repo, mockLogger());
    const out = await service.applyWorkflow('org-1', {
      alertIds: ['a1'],
      action: 'START_WORK' as any,
      performedByDisplayName: 'User',
    } as any);

    expect(out.succeeded).toEqual([]);
    expect(out.failed[0]).toMatchObject({ alertId: 'a1', code: 'NOT_FOUND' });
  });
});

