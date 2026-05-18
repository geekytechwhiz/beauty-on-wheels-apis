import {
  AlertIngestInputType,
  AlertIngestSourceType,
} from '../constants/alert-ingest.enum';
import {
  mapMissedReadingToCreateAlert,
  mapThresholdBreachToCreateAlert,
} from './alert-event-ingest.mapper';

const EPOCH_TRIGGER = Date.parse('2026-01-15T10:00:00.000Z');
const EPOCH_LAST_READING = Date.parse('2026-01-14T09:00:00.000Z');

describe('alert-event-ingest.mapper', () => {
  describe('mapThresholdBreachToCreateAlert', () => {
    it('maps threshold breach payload to THRESHOLD_BREACH create input', () => {
      const result = mapThresholdBreachToCreateAlert({
        patientId: 'pat-1',
        organizationId: 'org-1',
        metric: 'BP_SYSTOLIC',
        currentValue: 190,
        threshold: 140,
        severityHint: 'CRITICAL',
        triggeredAt: EPOCH_TRIGGER,
        inputEventId: 'threshold-evt-1',
        priority: 'CRITICAL_BAND',
        groupingKey: 'pat-1|BP_SYSTOLIC|OPEN',
        appliesToType: 'VITAL_SIGN',
        linkedEntityCode: 'BP_SYSTOLIC',
        triggerSummary: 'Systolic BP above limit',
      });

      expect(result.inputType).toBe(AlertIngestInputType.ThresholdBreach);
      expect(result.sourceType).toBe(AlertIngestSourceType.MonitoringService);
      expect(result.severityHint).toBe('CRITICAL');
      expect(result.priority).toBe('CRITICAL_BAND');
      expect(result.groupingKey).toBe('pat-1|BP_SYSTOLIC|OPEN');
      expect(result.triggerSummary).toBe('Systolic BP above limit');
      expect(result.appliesToType).toBe('VITAL_SIGN');
      expect(result.linkedEntityCode).toBe('BP_SYSTOLIC');
      expect(result.inputEventId).toBe('threshold-evt-1');
      expect(result.patientName).toBe('Unknown');
      expect(result.assignSlaMinutes).toBe(60);
      expect(result.resolveSlaMinutes).toBe(240);
      expect(result.evidencePayload).toMatchObject({
        inputType: AlertIngestInputType.ThresholdBreach,
        source: AlertIngestSourceType.MonitoringService,
        linkedEntityCode: 'BP_SYSTOLIC',
        metric: 'BP_SYSTOLIC',
        currentValue: 190,
        threshold: 140,
        severityHint: 'CRITICAL',
      });
    });

    it('uses explicit inputEventId when provided', () => {
      const result = mapThresholdBreachToCreateAlert({
        patientId: 'pat-1',
        organizationId: 'org-1',
        metric: 'HR',
        currentValue: 120,
        threshold: 100,
        severityHint: 'HIGH',
        triggeredAt: EPOCH_TRIGGER,
        inputEventId: 'external-id-99',
        priority: 'P1',
        groupingKey: 'g1',
        appliesToType: 'VITAL_SIGN',
        linkedEntityCode: 'HR',
      });

      expect(result.inputEventId).toBe('external-id-99');
    });
  });

  describe('mapMissedReadingToCreateAlert', () => {
    it('maps missed reading payload to MISSED_READING create input', () => {
      const result = mapMissedReadingToCreateAlert({
        patientId: 'pat-2',
        organizationId: 'org-2',
        readingType: 'BLOOD_PRESSURE',
        linkedEntityCode: 'BP_SYSTOLIC',
        lastSuccessfulReadingTimestamp: EPOCH_LAST_READING,
        missedDuration: '24h',
        triggeredAt: EPOCH_TRIGGER,
        appliesToType: 'VITAL_SIGN',
        severityHint: 'MEDIUM',
        inputEventId: 'missed-evt-1',
        priority: 'ROUTINE',
        groupingKey: 'pat-2|BP|OPEN',
        triggerSummary: 'No BP reading in 24h',
      });

      expect(result.inputType).toBe(AlertIngestInputType.MissedReading);
      expect(result.sourceType).toBe(AlertIngestSourceType.DeviceMonitoring);
      expect(result.priority).toBe('ROUTINE');
      expect(result.groupingKey).toBe('pat-2|BP|OPEN');
      expect(result.triggerSummary).toBe('No BP reading in 24h');
      expect(result.inputEventId).toBe('missed-evt-1');
      expect(result.evidencePayload).toEqual({
        eventTimestamp: EPOCH_TRIGGER,
        source: AlertIngestSourceType.DeviceMonitoring,
        inputType: AlertIngestInputType.MissedReading,
        appliesToType: 'VITAL_SIGN',
        linkedEntityCode: 'BP_SYSTOLIC',
        lastSuccessfulReadingTimestamp: EPOCH_LAST_READING,
        missedDuration: '24h',
        readingType: 'BLOOD_PRESSURE',
      });
    });

    it('applies optional ingest defaults when omitted', () => {
      const result = mapMissedReadingToCreateAlert({
        patientId: 'pat-2',
        organizationId: 'org-2',
        readingType: 'BLOOD_PRESSURE',
        linkedEntityCode: 'BP_SYSTOLIC',
        lastSuccessfulReadingTimestamp: EPOCH_LAST_READING,
        missedDuration: '24h',
        triggeredAt: EPOCH_TRIGGER,
        appliesToType: 'VITAL_SIGN',
        inputEventId: 'missed-evt-2',
        priority: 'P3',
        groupingKey: 'g2',
      });

      expect(result.patientName).toBe('Unknown');
      expect(result.alertPolicyTemplateVersionId).toBe('UNSPECIFIED');
      expect(result.assignSlaMinutes).toBe(60);
      expect(result.resolveSlaMinutes).toBe(240);
    });

    it('trims template ids and uses custom SLA when provided', () => {
      const result = mapThresholdBreachToCreateAlert({
        patientId: 'pat-1',
        organizationId: 'org-1',
        metric: 'HR',
        currentValue: 120,
        threshold: 100,
        triggeredAt: EPOCH_TRIGGER,
        inputEventId: 'evt-sla',
        priority: 'P1',
        groupingKey: 'g1',
        appliesToType: 'VITAL_SIGN',
        linkedEntityCode: 'HR',
        patientName: '  Pat Name  ',
        alertPolicyTemplateVersionId: '  policy-x  ',
        thresholdTemplateVersionId: '  thresh-x  ',
        assignSlaMinutes: 15,
        resolveSlaMinutes: 45,
      });

      expect(result.patientName).toBe('Pat Name');
      expect(result.alertPolicyTemplateVersionId).toBe('policy-x');
      expect(result.thresholdTemplateVersionId).toBe('thresh-x');
      expect(result.assignSlaMinutes).toBe(15);
      expect(result.resolveSlaMinutes).toBe(45);
    });
  });
});

