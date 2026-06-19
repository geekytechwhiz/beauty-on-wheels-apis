import { createMonitoringActionPayloadFromHttpBody } from '@api-hub/task-core';

import type { MonitoringActionRequestedPayload } from '../inbound/monitoring-action-requested.payload';

export function mapIngestPayloadToCreateMonitoringAction(payload: MonitoringActionRequestedPayload) {
  const { organizationId, ...body } = payload;
  return createMonitoringActionPayloadFromHttpBody(organizationId, body);
}
