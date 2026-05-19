import { mapIngestPayloadToCreateAlert } from './alert-event-ingest.mapper';

const EPOCH_TRIGGER = Date.parse('2026-01-15T10:00:00.000Z');

describe('alert-event-ingest.mapper', () => {
  describe('mapIngestPayloadToCreateAlert', () => {
    it('maps ingest payload to create alert request', () => {
      const result = mapIngestPayloadToCreateAlert({
        organizationId: 'org-1',
        inputEventId: 'threshold-evt-1',
        inputType: 'THRESHOLD_BREACH',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        patientName: 'Jane Doe',
        triggerTimestamp: EPOCH_TRIGGER,
        evidencePayload: {
          metric: 'BP_SYSTOLIC',
          currentValue: 190,
          threshold: 140,
          severityHint: 'CRITICAL',
        },
        priority: 'CRITICAL_BAND',
        groupingKey: 'pat-1|BP_SYSTOLIC|OPEN',
        appliesToType: 'VITAL_SIGN',
        linkedEntityCode: 'BP_SYSTOLIC',
        severityHint: 'CRITICAL',
        triggerSummary: 'Systolic BP above limit',
      });

      expect(result.inputType).toBe('THRESHOLD_BREACH');
      expect(result.sourceType).toBe('MONITORING_SERVICE');
      expect(result.evidencePayload).toMatchObject({
        metric: 'BP_SYSTOLIC',
        currentValue: 190,
        threshold: 140,
      });
    });

    it('trims inputEventId and applies optional defaults', () => {
      const result = mapIngestPayloadToCreateAlert({
        organizationId: 'org-2',
        inputEventId: '  missed-evt-1  ',
        inputType: 'MISSED_READING',
        sourceType: 'DEVICE_MONITORING',
        patientId: 'pat-2',
        patientName: 'John Smith',
        triggerTimestamp: EPOCH_TRIGGER,
        evidencePayload: {},
        priority: 'ROUTINE',
        groupingKey: 'pat-2|BP|OPEN',
      });

      expect(result.inputEventId).toBe('missed-evt-1');
      expect(result.patientName).toBe('John Smith');
      expect(result.alertPolicyTemplateVersionId).toBe('UNSPECIFIED');
    });

    it('trims patient name, template ids, and uses custom SLA', () => {
      const result = mapIngestPayloadToCreateAlert({
        organizationId: 'org-1',
        inputEventId: 'evt-sla',
        inputType: 'THRESHOLD_BREACH',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        patientName: '  Pat Name  ',
        triggerTimestamp: EPOCH_TRIGGER,
        evidencePayload: { metric: 'HR' },
        priority: 'P1',
        groupingKey: 'g1',
        alertPolicyTemplateVersionId: '  policy-x  ',
        thresholdTemplateVersionId: '  thresh-x  ',
        assignSlaMinutes: 15,
        resolveSlaMinutes: 45,
      });

      expect(result.patientName).toBe('Pat Name');
      expect(result.alertPolicyTemplateVersionId).toBe('policy-x');
      expect(result.assignSlaMinutes).toBe(15);
      expect(result.resolveSlaMinutes).toBe(45);
    });

    it('defaults evidencePayload to empty object when omitted', () => {
      const result = mapIngestPayloadToCreateAlert({
        organizationId: 'org-1',
        inputEventId: 'evt-1',
        inputType: 'THRESHOLD_BREACH',
        sourceType: 'MONITORING_SERVICE',
        patientId: 'pat-1',
        patientName: 'Jane Doe',
        triggerTimestamp: EPOCH_TRIGGER,
        priority: 'P1',
        groupingKey: 'g1',
      });

      expect(result.evidencePayload).toEqual({});
    });

    it('passes through trigger summary template fields', () => {
      const result = mapIngestPayloadToCreateAlert({
        organizationId: 'org-1',
        inputEventId: 'evt-1',
        inputType: 'MISSED_READING',
        sourceType: 'DEVICE_MONITORING',
        patientId: 'pat-1',
        patientName: 'Jane Doe',
        triggerTimestamp: EPOCH_TRIGGER,
        priority: 'P2',
        groupingKey: 'g1',
        triggerSummaryTemplateCode: 'MISSED_READING_V1',
        triggerSummaryParams: { missedDuration: '24h' },
      });

      expect(result.triggerSummaryTemplateCode).toBe('MISSED_READING_V1');
      expect(result.triggerSummaryParams).toEqual({ missedDuration: '24h' });
    });

    it('falls back to evidence for appliesToType and linkedEntityCode', () => {
      const result = mapIngestPayloadToCreateAlert({
        organizationId: 'org-1',
        inputEventId: 'evt-1',
        inputType: 'MISSED_READING',
        sourceType: 'DEVICE_MONITORING',
        patientId: 'pat-1',
        patientName: 'Jane Doe',
        triggerTimestamp: EPOCH_TRIGGER,
        evidencePayload: {
          appliesToType: 'VITAL_SIGN',
          linkedEntityCode: 'BP_SYSTOLIC',
        },
        priority: 'P2',
        groupingKey: 'g1',
      });

      expect(result.appliesToType).toBe('VITAL_SIGN');
      expect(result.linkedEntityCode).toBe('BP_SYSTOLIC');
    });
  });
});
