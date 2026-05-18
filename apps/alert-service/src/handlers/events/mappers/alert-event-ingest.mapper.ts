import {
  DEFAULT_ASSIGN_SLA_MINUTES,
  DEFAULT_RESOLVE_SLA_MINUTES,
  type CreateAlertRequest,
} from '@api-hub/alert-core';

import {
  AlertIngestInputType,
  AlertIngestSourceType,
} from '../constants/alert-ingest.enum';
import type { MissedReadingEventPayload } from '../inbound/missed-reading.payload';
import type { ThresholdBreachEventPayload } from '../inbound/threshold-breach.payload';

const UNSPECIFIED_TEMPLATE_VERSION = 'UNSPECIFIED';

function eventIngestDefaults(
  payload: {
    patientName?: string;
    alertPolicyTemplateVersionId?: string;
    thresholdTemplateVersionId?: string;
    assignSlaMinutes?: number;
    resolveSlaMinutes?: number;
  },
): Pick<
  CreateAlertRequest,
  | 'patientName'
  | 'alertPolicyTemplateVersionId'
  | 'thresholdTemplateVersionId'
  | 'assignSlaMinutes'
  | 'resolveSlaMinutes'
> {
  return {
    patientName: payload.patientName?.trim() || 'Unknown',
    alertPolicyTemplateVersionId:
      payload.alertPolicyTemplateVersionId?.trim() || UNSPECIFIED_TEMPLATE_VERSION,
    thresholdTemplateVersionId:
      payload.thresholdTemplateVersionId?.trim() || UNSPECIFIED_TEMPLATE_VERSION,
    assignSlaMinutes: payload.assignSlaMinutes ?? DEFAULT_ASSIGN_SLA_MINUTES,
    resolveSlaMinutes: payload.resolveSlaMinutes ?? DEFAULT_RESOLVE_SLA_MINUTES,
  };
}

export function mapThresholdBreachToCreateAlert(
  payload: ThresholdBreachEventPayload,
): CreateAlertRequest {
  const inputType = AlertIngestInputType.ThresholdBreach;
  const sourceType = AlertIngestSourceType.MonitoringService;

  return {
    organizationId: payload.organizationId,
    inputEventId: payload.inputEventId.trim(),
    inputType,
    sourceType,
    patientId: payload.patientId,
    triggerTimestamp: payload.triggeredAt,
    severityHint: payload.severityHint,
    priority: payload.priority,
    groupingKey: payload.groupingKey,
    triggerSummary: payload.triggerSummary,
    appliesToType: payload.appliesToType,
    linkedEntityCode: payload.linkedEntityCode,
    ...eventIngestDefaults(payload),
    evidencePayload: {
      eventTimestamp: payload.triggeredAt,
      source: sourceType,
      inputType,
      appliesToType: payload.appliesToType,
      linkedEntityCode: payload.linkedEntityCode,
      metric: payload.metric,
      currentValue: payload.currentValue,
      threshold: payload.threshold,
      severityHint: payload.severityHint,
    },
  };
}

export function mapMissedReadingToCreateAlert(
  payload: MissedReadingEventPayload,
): CreateAlertRequest {
  const inputType = AlertIngestInputType.MissedReading;
  const sourceType = AlertIngestSourceType.DeviceMonitoring;

  return {
    organizationId: payload.organizationId,
    inputEventId: payload.inputEventId.trim(),
    inputType,
    sourceType,
    patientId: payload.patientId,
    triggerTimestamp: payload.triggeredAt,
    severityHint: payload.severityHint,
    priority: payload.priority,
    carePlanInstanceId: payload.carePlanInstanceId,
    packageAssignmentId: payload.packageAssignmentId,
    groupingKey: payload.groupingKey,
    triggerSummary: payload.triggerSummary,
    appliesToType: payload.appliesToType,
    linkedEntityCode: payload.linkedEntityCode,
    ...eventIngestDefaults(payload),
    evidencePayload: {
      eventTimestamp: payload.triggeredAt,
      source: sourceType,
      inputType,
      appliesToType: payload.appliesToType,
      linkedEntityCode: payload.linkedEntityCode,
      lastSuccessfulReadingTimestamp: payload.lastSuccessfulReadingTimestamp,
      missedDuration: payload.missedDuration,
      readingType: payload.readingType,
    },
  };
}
