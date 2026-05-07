import { AlertEntityBuilder } from './alert-entity.builder';
import { AlertKeyBuilder } from './alert-key.builder';
import { ALERT_STATE } from '../models/types/alert-state.type';
import {
  DEFAULT_ASSIGN_SLA_MINUTES,
  DEFAULT_RESOLVE_SLA_MINUTES,
} from '../constants/alert.constants';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';

const MS_PER_MINUTE = 60_000;

function minimalRow(overrides: Partial<AlertDdbRecord> = {}): AlertDdbRecord {
  const alertId = 'a1';
  const created = Date.parse('2026-01-15T10:00:00.000Z');
  return {
    pk: 'ALERT#a1',
    sk: 'METADATA',
    entityType: 'ALERT',
    alertId,
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: created,
    triggerSummary: 't',
    evidencePayload: {},
    priority: 'P2',
    alertState: ALERT_STATE.UNASSIGNED,
    groupingKey: 'g1',
    assignSlaMinutes: 60,
    resolveSlaMinutes: 240,
    assignSlaDueAt: created + 60 * MS_PER_MINUTE,
    slaBreachIndicator: false,
    createdAt: created,
    updatedAt: created,
    statusUpdatedAt: created,
    gsi1pk: AlertKeyBuilder.buildGsi1Pk('org-1', ALERT_STATE.UNASSIGNED),
    gsi1sk: AlertKeyBuilder.buildGsi1Sk(created),
    gsi3pk: AlertKeyBuilder.toPatPartitionKey('pat-1'),
    gsi3sk: AlertKeyBuilder.toGsi3Sk(created),
    gsi4pk: AlertKeyBuilder.buildGsi4Pk('org-1'),
    gsi4sk: AlertKeyBuilder.buildGsi4Sk(created, alertId),
    gsi5pk: AlertKeyBuilder.toSlaPartitionKey(created + 60 * MS_PER_MINUTE),
    gsi5sk: AlertKeyBuilder.toSlaSortKey(created + 60 * MS_PER_MINUTE, alertId),
    ...overrides,
  } as AlertDdbRecord;
}

describe('AlertEntityBuilder.buildUpdateExpression — SLA wiring', () => {
  const NOW = Date.parse('2026-01-15T10:30:00.000Z');

  beforeEach(() => {
    process.env.ALERT_TABLE = 'test-alert-table';
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ALERT_TABLE;
  });

  describe('first assignment (UNASSIGNED → ASSIGNED with assignee)', () => {
    it('starts the resolve-SLA clock and re-keys GSI5 to resolveSlaDueAt', () => {
      const row = minimalRow();
      const expectedDue = (row.createdAt as number) + 240 * MS_PER_MINUTE;

      const out = AlertEntityBuilder.buildUpdateExpression(row, {
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        assignedToDisplayName: 'User One',
      });

      expect(out.ExpressionAttributeValues).toMatchObject({
        ':resolveSlaDueAt': expectedDue,
        ':gsi5pk': AlertKeyBuilder.toSlaPartitionKey(expectedDue),
        ':gsi5sk': AlertKeyBuilder.toSlaSortKey(expectedDue, row.alertId),
      });
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':resolveSlaMinutes');
    });

    it('writes resolveSlaMinutes when missing on the existing row, falling back to env/default', () => {
      const row = minimalRow({ resolveSlaMinutes: undefined as unknown as number });
      const expectedDue = (row.createdAt as number) + DEFAULT_RESOLVE_SLA_MINUTES * MS_PER_MINUTE;

      const out = AlertEntityBuilder.buildUpdateExpression(row, {
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        assignedToDisplayName: 'User One',
      });

      expect(out.ExpressionAttributeValues).toMatchObject({
        ':resolveSlaMinutes': DEFAULT_RESOLVE_SLA_MINUTES,
        ':resolveSlaDueAt': expectedDue,
      });
    });

    it('skips the resolve-SLA block when resolveSlaMinutes is 0 ("no SLA tracked")', () => {
      const row = minimalRow({ resolveSlaMinutes: 0 });

      const out = AlertEntityBuilder.buildUpdateExpression(row, {
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-1',
        assignedToDisplayName: 'User One',
      });

      expect(out.ExpressionAttributeValues).not.toHaveProperty(':resolveSlaDueAt');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':gsi5pk');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':gsi5sk');
    });
  });

  describe('reassignment (already assigned)', () => {
    it('does NOT reset resolveSlaDueAt or rewrite GSI5', () => {
      const created = Date.parse('2026-01-15T10:00:00.000Z');
      const row = minimalRow({
        alertState: ALERT_STATE.IN_PROGRESS,
        assignedToUserId: 'user-old',
        assignedToDisplayName: 'User Old',
        resolveSlaDueAt: created + 60 * MS_PER_MINUTE,
      });

      const out = AlertEntityBuilder.buildUpdateExpression(row, {
        assignedToUserId: 'user-new',
        assignedToDisplayName: 'User New',
      });

      expect(out.ExpressionAttributeValues).not.toHaveProperty(':resolveSlaDueAt');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':gsi5pk');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':gsi5sk');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':resolveSlaMinutes');
    });
  });

  describe('unassign (assignedToUserId: null)', () => {
    it('does not touch resolveSlaDueAt / gsi5* (clock keeps running)', () => {
      const row = minimalRow({
        alertState: ALERT_STATE.IN_PROGRESS,
        assignedToUserId: 'user-1',
      });

      const out = AlertEntityBuilder.buildUpdateExpression(row, {
        assignedToUserId: null,
        assignedToDisplayName: null,
      });

      expect(out.ExpressionAttributeValues).not.toHaveProperty(':resolveSlaDueAt');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':gsi5pk');
      expect(out.ExpressionAttributeValues).not.toHaveProperty(':gsi5sk');
    });
  });
});

describe('AlertEntityBuilder.buildAlertRecord — SLA wiring', () => {
  beforeEach(() => {
    delete process.env.ALERT_DEFAULT_ASSIGN_SLA_MINUTES;
    delete process.env.ALERT_DEFAULT_RESOLVE_SLA_MINUTES;
  });

  it('falls back to DEFAULT_*_SLA_MINUTES when input omits SLA fields', () => {
    const ctx = AlertEntityBuilder.buildCreateContext({
      alertId: 'a1',
      input: {
        organizationId: 'org-1',
        inputType: 'MISSED_READING',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        triggerTimestamp: '2026-01-15T10:00:00.000Z',
        evidencePayload: {},
      },
    });

    const record = AlertEntityBuilder.buildAlertRecord(ctx);

    expect(record.assignSlaMinutes).toBe(DEFAULT_ASSIGN_SLA_MINUTES);
    expect(record.resolveSlaMinutes).toBe(DEFAULT_RESOLVE_SLA_MINUTES);
    expect(record.assignSlaDueAt).toBe(record.createdAt + DEFAULT_ASSIGN_SLA_MINUTES * MS_PER_MINUTE);
    expect(record.resolveSlaDueAt).toBeUndefined();
    expect(record.gsi5pk).toBe(AlertKeyBuilder.toSlaPartitionKey(record.assignSlaDueAt));
    expect(record.gsi5sk).toBe(AlertKeyBuilder.toSlaSortKey(record.assignSlaDueAt, record.alertId));
  });

  it('honors caller-provided SLA minutes', () => {
    const ctx = AlertEntityBuilder.buildCreateContext({
      alertId: 'a1',
      input: {
        organizationId: 'org-1',
        inputType: 'MISSED_READING',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        triggerTimestamp: '2026-01-15T10:00:00.000Z',
        evidencePayload: {},
        assignSlaMinutes: 15,
        resolveSlaMinutes: 90,
      },
    });

    const record = AlertEntityBuilder.buildAlertRecord(ctx);

    expect(record.assignSlaMinutes).toBe(15);
    expect(record.resolveSlaMinutes).toBe(90);
    expect(record.assignSlaDueAt).toBe(record.createdAt + 15 * MS_PER_MINUTE);
  });

  it('treats 0 as "no SLA tracked" — assignSlaDueAt = createdAt sentinel', () => {
    const ctx = AlertEntityBuilder.buildCreateContext({
      alertId: 'a1',
      input: {
        organizationId: 'org-1',
        inputType: 'MISSED_READING',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        triggerTimestamp: '2026-01-15T10:00:00.000Z',
        evidencePayload: {},
        assignSlaMinutes: 0,
        resolveSlaMinutes: 0,
      },
    });

    const record = AlertEntityBuilder.buildAlertRecord(ctx);

    expect(record.assignSlaMinutes).toBe(0);
    expect(record.assignSlaDueAt).toBe(record.createdAt);
  });
});
