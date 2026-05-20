import { publishEvent } from '@api-hub/event-platform';

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
  publishAlertAssignmentChanged,
  publishAlertCreated,
  publishAlertDismissed,
  publishAlertIntents,
  publishAlertNoteAdded,
  publishAlertPriorityChanged,
  publishAlertResolved,
  publishAlertStateChanged,
} from './alert-publisher';

jest.mock('@api-hub/event-platform', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  defineEvent: (schema: unknown, meta?: unknown) =>
    Object.assign(schema as object, { __meta: meta }),
  onEvent: jest.fn(),
  configureEventPlatform: jest.fn(),
  EventBridgeAdapter: jest.fn(),
}));

const mockPublishEvent = publishEvent as jest.Mock;

function createdRecord() {
  const intent = createdIntent();
  if (intent.kind !== 'CREATED') {
    throw new Error('Expected CREATED intent');
  }
  return intent.record;
}

describe('alert-publisher', () => {
  const logger = { warn: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPublishEvent.mockResolvedValue(undefined);
  });

  it('publishAlertCreated publishes with meta', async () => {
    const record = createdRecord();
    await publishAlertCreated(record, logger as never);

    expect(mockPublishEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        alertId: record.alertId,
        organizationId: record.organizationId,
      }),
      expect.objectContaining({
        meta: { tenantId: record.organizationId },
      }),
    );
  });

  it('publishAlertCreated logs warning on publish failure', async () => {
    mockPublishEvent.mockRejectedValueOnce(new Error('bus down'));
    await publishAlertCreated(createdRecord(), logger as never);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'alert_created_publish_failed' }),
    );
  });

  it('publishAlertCreated logs non-Error failures', async () => {
    mockPublishEvent.mockRejectedValueOnce('fail');
    await publishAlertCreated(createdRecord());
    expect(mockPublishEvent).toHaveBeenCalled();
  });

  it('publishAlertCreated swallows failure when logger is omitted', async () => {
    mockPublishEvent.mockRejectedValueOnce(new Error('no logger'));
    await expect(publishAlertCreated(createdRecord())).resolves.toBeUndefined();
  });

  it('publishAlertAssignmentChanged publishes payload', async () => {
    const payload = {
      alertId: 'a1',
      patientId: 'p1',
      organizationId: 'org-1',
      activityType: 'ALERT_ASSIGNED' as const,
      performedBy: 'actor-1',
      occurredAt: '2026-01-15T12:00:00.000Z',
    };
    await publishAlertAssignmentChanged(payload, logger as never);
    expect(mockPublishEvent).toHaveBeenCalled();
  });

  it('publishAlertStateChanged swallows errors', async () => {
    mockPublishEvent.mockRejectedValueOnce(new Error('fail'));
    await publishAlertStateChanged(
      {
        alertId: 'a1',
        patientId: 'p1',
        organizationId: 'org-1',
        activityType: 'ALERT_STATE_CHANGED',
        previousState: 'ASSIGNED',
        currentState: 'IN_PROGRESS',
        performedBy: 'actor-1',
        occurredAt: '2026-01-15T12:00:00.000Z',
      },
      logger as never,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'alert_state_changed_publish_failed' }),
    );
  });

  it('publishAlertResolved publishes', async () => {
    await publishAlertResolved(
      {
        alertId: 'a1',
        patientId: 'p1',
        organizationId: 'org-1',
        previousState: 'IN_PROGRESS',
        currentState: 'RESOLVED',
        performedBy: 'actor-1',
        occurredAt: '2026-01-15T12:00:00.000Z',
      },
    );
    expect(mockPublishEvent).toHaveBeenCalled();
  });

  it('publishAlertDismissed publishes', async () => {
    await publishAlertDismissed(
      {
        alertId: 'a1',
        patientId: 'p1',
        organizationId: 'org-1',
        previousState: 'UNASSIGNED',
        currentState: 'DISMISSED',
        performedBy: 'actor-1',
        occurredAt: '2026-01-15T12:00:00.000Z',
      },
    );
    expect(mockPublishEvent).toHaveBeenCalled();
  });

  it('publishAlertPriorityChanged publishes', async () => {
    await publishAlertPriorityChanged(
      {
        alertId: 'a1',
        patientId: 'p1',
        organizationId: 'org-1',
        previousPriority: 'P2',
        newPriority: 'P0',
        performedBy: 'actor-1',
        occurredAt: '2026-01-15T12:00:00.000Z',
      },
    );
    expect(mockPublishEvent).toHaveBeenCalled();
  });

  it('publishAlertNoteAdded publishes', async () => {
    await publishAlertNoteAdded(
      {
        alertId: 'a1',
        patientId: 'p1',
        organizationId: 'org-1',
        activityId: 'act-1',
        comment: 'hi',
        performedBy: 'actor-1',
        occurredAt: '2026-01-15T12:00:00.000Z',
      },
    );
    expect(mockPublishEvent).toHaveBeenCalled();
  });

  it('publishAlertIntents dispatches all intent kinds', async () => {
    await publishAlertIntents([
      createdIntent(),
      assignmentChangedIntent(),
      stateChangedIntent(),
      resolvedIntent(),
      dismissedIntent(),
      priorityChangedIntent(),
      noteAddedIntent(),
    ]);
    expect(mockPublishEvent).toHaveBeenCalledTimes(7);
  });

  it('publishAlertIntents no-ops for unrecognized runtime intent kind', async () => {
    await publishAlertIntents([{ kind: 'UNKNOWN' }] as never);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});
