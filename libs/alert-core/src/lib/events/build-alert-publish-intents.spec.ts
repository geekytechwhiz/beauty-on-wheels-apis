import { AlertActivityType } from '../constants/alert-activity-type';
import { AlertKeyBuilder } from '../builder/alert-key.builder';
import { ALERT_STATE } from '../models/types/alert-state.type';
import type { AlertDdbRecord } from '../models/persistence/alert-ddb.model';
import {
  buildCreatePublishIntents,
  buildPublishIntentsFromWorkflowUpdate,
} from './build-alert-publish-intents';

function minimalRecord(overrides: Partial<AlertDdbRecord> = {}): AlertDdbRecord {
  const alertId = '11111111-1111-4111-8111-111111111111';
  const created = Date.parse('2026-01-15T10:00:01.000Z');
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
    gsi5pk: AlertKeyBuilder.toSlaPartitionKey(created),
    gsi5sk: AlertKeyBuilder.toSlaSortKey(created, alertId),
    alertId,
    organizationId: 'org-1',
    patientId: 'pat-1',
    inputEventId: 'evt-1',
    inputType: 'MISSED_READING',
    sourceType: 'MONITORING_SERVICE',
    triggerTimestamp: Date.parse('2026-01-15T10:00:00.000Z'),
    triggerSummary: 'No reading',
    evidencePayload: {},
    priority: 'P2',
    alertState: ALERT_STATE.UNASSIGNED,
    groupingKey: 'g1',
    assignSlaMinutes: 60,
    resolveSlaMinutes: 240,
    assignSlaDueAt: created,
    resolveSlaDueAt: created,
    slaBreachIndicator: false,
    createdAt: created,
    updatedAt: created,
    statusUpdatedAt: created,
    ...overrides,
  } as AlertDdbRecord;
}

describe('build-alert-publish-intents', () => {
  const nowMs = Date.parse('2026-01-15T12:00:00.000Z');

  it('emits ASSIGNMENT_CHANGED for assign without separate state intent', () => {
    const existing = minimalRecord();
    const intents = buildPublishIntentsFromWorkflowUpdate({
      existing,
      patch: {
        alertState: ALERT_STATE.ASSIGNED,
        assignedToUserId: 'user-9',
        assignedToDisplayName: 'User Nine',
      },
      performedBy: 'actor-1',
      nowMs,
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: 'ASSIGNMENT_CHANGED',
      activityType: AlertActivityType.AlertAssigned,
      alertId: existing.alertId,
      newAssignee: 'user-9',
    });
  });

  it('emits RESOLVED intent for resolve transition', () => {
    const existing = minimalRecord({ alertState: ALERT_STATE.IN_PROGRESS });
    const intents = buildPublishIntentsFromWorkflowUpdate({
      existing,
      patch: { alertState: ALERT_STATE.RESOLVED, closureComment: 'done' },
      performedBy: 'actor-1',
      nowMs,
    });

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: 'RESOLVED',
      previousState: ALERT_STATE.IN_PROGRESS,
      newState: ALERT_STATE.RESOLVED,
      activityComment: 'done',
    });
  });

  it('buildCreatePublishIntents returns only CREATED', () => {
    const record = minimalRecord();
    expect(buildCreatePublishIntents(record)).toEqual([{ kind: 'CREATED', record }]);
  });
});
