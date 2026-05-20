import { minimalAlertRecord } from '../../../__tests__/handler-test-utils';
import {
  assignmentChangedIntent,
  createdIntent,
  dismissedIntent,
  noteAddedIntent,
  priorityChangedIntent,
  resolvedIntent,
  stateChangedIntent,
} from '../__tests__/event-test-fixtures';
import {
  mapAlertAssignmentChangedPayload,
  mapAlertCreatedPayload,
  mapAlertDismissedPayload,
  mapAlertNoteAddedPayload,
  mapAlertPriorityChangedPayload,
  mapAlertResolvedPayload,
  mapAlertStateChangedPayload,
} from './alert-publish.mapper';

describe('alert-publish.mapper', () => {
  it('mapAlertCreatedPayload uses numeric createdAt', () => {
    const createdMs = Date.parse('2026-01-15T10:00:01.000Z');
    const record = minimalAlertRecord({ createdAt: createdMs });
    const payload = mapAlertCreatedPayload(record);
    expect(payload.createdAt).toBe(new Date(createdMs).toISOString());
    expect(payload).toMatchObject({
      alertId: record.alertId,
      patientId: record.patientId,
      organizationId: record.organizationId,
      priority: record.priority,
      state: record.alertState,
    });
  });

  it('mapAlertCreatedPayload falls back when createdAt is not a number', () => {
    const record = minimalAlertRecord({ createdAt: 'not-a-number' as unknown as number });
    const payload = mapAlertCreatedPayload(record);
    expect(() => new Date(payload.createdAt)).not.toThrow();
  });

  it('mapAlertAssignmentChangedPayload maps intent fields', () => {
    const intent = assignmentChangedIntent();
    expect(mapAlertAssignmentChangedPayload(intent)).toEqual({
      alertId: intent.alertId,
      patientId: intent.patientId,
      organizationId: intent.organizationId,
      activityType: intent.activityType,
      previousAssignee: intent.previousAssignee,
      newAssignee: intent.newAssignee,
      previousAssigneeDisplayName: intent.previousAssigneeDisplayName,
      newAssigneeDisplayName: intent.newAssigneeDisplayName,
      performedBy: intent.performedBy,
      performedByDisplayName: intent.performedByDisplayName,
      occurredAt: intent.occurredAt,
    });
  });

  it('mapAlertStateChangedPayload maps intent fields', () => {
    const intent = stateChangedIntent();
    expect(mapAlertStateChangedPayload(intent)).toMatchObject({
      previousState: intent.previousState,
      currentState: intent.newState,
      activityType: intent.activityType,
    });
  });

  it('mapAlertResolvedPayload maps intent fields', () => {
    const intent = resolvedIntent();
    expect(mapAlertResolvedPayload(intent)).toMatchObject({
      activityComment: 'Resolved',
      currentState: intent.newState,
    });
  });

  it('mapAlertDismissedPayload maps intent fields', () => {
    const intent = dismissedIntent();
    expect(mapAlertDismissedPayload(intent)).toMatchObject({
      activityComment: 'Dismissed',
    });
  });

  it('mapAlertPriorityChangedPayload maps intent fields', () => {
    const intent = priorityChangedIntent();
    expect(mapAlertPriorityChangedPayload(intent)).toEqual({
      alertId: intent.alertId,
      patientId: intent.patientId,
      organizationId: intent.organizationId,
      previousPriority: intent.previousPriority,
      newPriority: intent.newPriority,
      performedBy: intent.performedBy,
      performedByDisplayName: intent.performedByDisplayName,
      occurredAt: intent.occurredAt,
    });
  });

  it('mapAlertNoteAddedPayload uses numeric activityTimestamp', () => {
    const intent = noteAddedIntent();
    const ts = intent.activity.activityTimestamp as number;
    const payload = mapAlertNoteAddedPayload(intent);
    expect(payload.occurredAt).toBe(new Date(ts).toISOString());
    expect(payload).toMatchObject({
      alertId: intent.alertId,
      activityId: 'act-1',
      comment: 'Note text',
      performedBy: 'actor-1',
    });
  });

  it('mapAlertNoteAddedPayload defaults empty comment', () => {
    const intent = noteAddedIntent();
    const payload = mapAlertNoteAddedPayload({
      ...intent,
      activity: { ...intent.activity, activityComment: undefined },
    });
    expect(payload.comment).toBe('');
  });

  it('mapAlertNoteAddedPayload falls back when activityTimestamp is not numeric', () => {
    const intent = noteAddedIntent();
    const broken = {
      ...intent,
      activity: {
        ...intent.activity,
        activityTimestamp: '2026-01-15T11:00:00.000Z' as unknown as number,
      },
    };
    const payload = mapAlertNoteAddedPayload(broken);
    expect(() => new Date(payload.occurredAt)).not.toThrow();
  });

  it('createdIntent record round-trip', () => {
    const record = minimalAlertRecord();
    const payload = mapAlertCreatedPayload(createdIntent(record).record);
    expect(payload.alertId).toBe(record.alertId);
    expect(payload.state).toBe(record.alertState);
  });
});
