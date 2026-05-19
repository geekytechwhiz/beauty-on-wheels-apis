/**
 * @jest-environment node
 */
import { eventBridgeTransportProfile } from '../transports/eventbridge/profile';
import { sqsTransportProfile } from '../transports/sqs/profile';

describe('transport profile contracts', () => {
  it('unwraps EventBridge detail into a BaseEvent', () => {
    const envelope = eventBridgeTransportProfile.parseInbound({
      source: 'monitoring-service',
      'detail-type': 'Threshold.Breach.v1',
      detail: {
        eventId: 'evt-1',
        eventType: 'Threshold.Breach.v1',
        eventVersion: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'monitoring-service',
        idempotencyKey: 'idem-1',
        payload: { patientId: 'p1' },
        meta: { correlationId: 'corr-1' },
      },
    });

    const baseEvent = eventBridgeTransportProfile.mapToBaseEvent(envelope);
    expect(baseEvent.eventType).toBe('Threshold.Breach.v1');
    expect(baseEvent.meta.correlationId).toBe('corr-1');
  });

  it('unwraps SQS body payloads into a BaseEvent', () => {
    const envelope = sqsTransportProfile.parseInbound({
      messageId: 'mid-1',
      receiptHandle: 'rh-1',
      body: JSON.stringify({
        eventId: 'evt-1',
        eventType: 'Alert.Created',
        eventVersion: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'alerts',
        idempotencyKey: 'idem-1',
        payload: { alertId: 'a1' },
        meta: { correlationId: 'corr-1' },
      }),
    });

    const baseEvent = sqsTransportProfile.mapToBaseEvent(envelope);
    expect(baseEvent.eventType).toBe('Alert.Created');
    expect(envelope.attributes.messageId).toBe('mid-1');
  });
});
