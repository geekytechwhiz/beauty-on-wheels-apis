import { AlertService } from '@api-hub/alert-core';
import { onEvent } from '@api-hub/event-platform';
import { ThresholdBreachEventSchema } from '../../inbound/threshold-breach.event';
import { publishAlertCreated } from '../../publisher/alert-publisher';

const alertService = new AlertService();
  
  export const handler = onEvent(
    ThresholdBreachEventSchema,
  
    async (event) => {
      const priority =
        event.payload.severity === 'CRITICAL'
          ? 'P0'
          : 'P1';

      const { record } = await alertService.createAlert({
          organizationId: event.payload.organizationId,
          inputEventId: [
            event.payload.organizationId,
            event.payload.patientId,
            event.payload.metric,
            event.payload.triggeredAt,
          ].join(':'),
          inputType: 'MISSED_READING',
          sourceType: 'MONITORING_SERVICE',
          patientId: event.payload.patientId,
          triggerTimestamp: event.payload.triggeredAt,
          severityHint: event.payload.severity,
          priority,
          groupingKey: `threshold:${event.payload.patientId}:${event.payload.metric}`,
          triggerSummary: `Threshold breached for ${event.payload.metric}: ${event.payload.currentValue} > ${event.payload.threshold}`,
          evidencePayload: {
            eventTimestamp: event.payload.triggeredAt,
            source: 'MONITORING_SERVICE',
            inputType: 'MISSED_READING',
            appliesToType: 'VITAL_SIGN',
            linkedEntityCode: event.payload.metric,
            lastSuccessfulReadingTimestamp: event.payload.triggeredAt,
            missedDuration: '0m',
            readingType: event.payload.metric,
          },
      });

      await publishAlertCreated({
        alertId: record.alertId,
        patientId: record.patientId,
        organizationId: record.organizationId,
        priority: record.priority,
        state: record.alertState,
        createdAt: record.createdAt,
      });
    },
  );