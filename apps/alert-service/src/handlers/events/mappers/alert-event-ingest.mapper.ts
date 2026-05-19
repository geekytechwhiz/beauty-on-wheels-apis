import {
  DEFAULT_ASSIGN_SLA_MINUTES,
  DEFAULT_RESOLVE_SLA_MINUTES,
  type CreateAlertRequest,
} from '@api-hub/alert-core';

import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';

const UNSPECIFIED_TEMPLATE_VERSION = 'UNSPECIFIED';

export function mapIngestPayloadToCreateAlert(
  payload: AlertCreateIngestPayload,
): CreateAlertRequest {
  const ev = payload.evidencePayload ?? {};

  return {
    organizationId: payload.organizationId,
    inputEventId: payload.inputEventId.trim(),
    inputType: payload.inputType,
    sourceType: payload.sourceType,
    patientId: payload.patientId,
    patientName: payload.patientName.trim(),
    triggerTimestamp: payload.triggerTimestamp,
    severityHint: payload.severityHint,
    priority: payload.priority,
    groupingKey: payload.groupingKey,
    triggerSummary: payload.triggerSummary,
    triggerSummaryTemplateCode: payload.triggerSummaryTemplateCode,
    triggerSummaryParams: payload.triggerSummaryParams,
    carePlanInstanceId: payload.carePlanInstanceId,
    packageAssignmentId: payload.packageAssignmentId,
    appliesToType:
      payload.appliesToType ?? (typeof ev.appliesToType === 'string' ? ev.appliesToType : undefined),
    linkedEntityCode:
      payload.linkedEntityCode ??
      (typeof ev.linkedEntityCode === 'string' ? ev.linkedEntityCode : undefined),
    alertPolicyTemplateVersionId:
      payload.alertPolicyTemplateVersionId?.trim() || UNSPECIFIED_TEMPLATE_VERSION,
    thresholdTemplateVersionId:
      payload.thresholdTemplateVersionId?.trim() || UNSPECIFIED_TEMPLATE_VERSION,
    assignSlaMinutes: payload.assignSlaMinutes ?? DEFAULT_ASSIGN_SLA_MINUTES,
    resolveSlaMinutes: payload.resolveSlaMinutes ?? DEFAULT_RESOLVE_SLA_MINUTES,
    evidencePayload: { ...ev },
  };
}
