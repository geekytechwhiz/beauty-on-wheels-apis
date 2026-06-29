import { TASK_METADATA_TYPE } from './task-metadata.constants';
import type { MetadataValuesByTypesResultDto } from './task-metadata.dto';
import {
  buildMetadataLabelLookup,
  collectMetadataTypesFromTask,
  enrichRuntimeTaskCard,
  enrichRuntimeTaskLabels,
  enrichTaskStatusSummaryLabels,
  resolveLabel,
} from './task-metadata.enrichment';

function registryFixture(
  entries: Array<{ type: string; codes: Array<{ code: string; label?: string; status?: string }> }>,
): MetadataValuesByTypesResultDto {
  return {
    items: entries.map((entry) => ({
      metadataType: entry.type,
      values: entry.codes.map(({ code, label, status }) => ({
        valueCode: code,
        label: label ?? code,
        status: status ?? 'active',
      })),
    })),
    missingMetadataTypeCodes: [],
  };
}

describe('task-metadata.enrichment', () => {
  const lookup = buildMetadataLabelLookup({
    items: [
      {
        metadataType: TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE,
        values: [{ valueCode: 'METRIC_CHECKIN', label: 'Metric Check-in', status: 'active' }],
      },
      {
        metadataType: TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
        values: [{ valueCode: 'patient', label: 'Patient', status: 'active' }],
      },
      {
        metadataType: TASK_METADATA_TYPE.REMINDER_CHANNEL,
        values: [
          { valueCode: 'push', label: 'Push Notification', status: 'active' },
          { valueCode: 'sms', label: 'SMS', status: 'active' },
        ],
      },
      {
        metadataType: TASK_METADATA_TYPE.CURRENT_STATE,
        values: [{ valueCode: 'open', label: 'Active', status: 'active' }],
      },
      {
        metadataType: TASK_METADATA_TYPE.READINESS_STATUS,
        values: [{ valueCode: 'ready', label: 'Ready', status: 'active' }],
      },
    ],
    missingMetadataTypeCodes: [],
  });

  const task = {
    taskBehaviorCode: 'METRIC_CHECKIN',
    assignedToType: 'patient',
    currentState: 'open',
    reminderSettings: { channels: ['push', 'sms'] },
  };

  it('builds label lookup from registry valueCodes and resolves exact matches', () => {
    expect(resolveLabel(lookup, TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE, 'METRIC_CHECKIN')).toBe(
      'Metric Check-in',
    );
    expect(resolveLabel(lookup, TASK_METADATA_TYPE.REMINDER_CHANNEL, 'push')).toBe('Push Notification');
    expect(resolveLabel(lookup, TASK_METADATA_TYPE.CURRENT_STATE, 'open')).toBe('Active');
  });

  it('resolves labels case-insensitively when registry casing differs', () => {
    const mixedCaseLookup = buildMetadataLabelLookup(
      registryFixture([
        {
          type: TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
          codes: [{ code: 'Patient', label: 'Patient' }],
        },
      ]),
    );
    expect(resolveLabel(mixedCaseLookup, TASK_METADATA_TYPE.ASSIGNED_TO_TYPE, 'patient')).toBe('Patient');
  });

  it('skips inactive registry values', () => {
    const inactiveLookup = buildMetadataLabelLookup(
      registryFixture([
        {
          type: TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE,
          codes: [{ code: 'OLD_CODE', label: 'Old', status: 'inactive' }],
        },
      ]),
    );
    expect(resolveLabel(inactiveLookup, TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE, 'OLD_CODE')).toBeUndefined();
  });

  it('collects metadata types present on a task card', () => {
    expect(collectMetadataTypesFromTask(task)).toEqual(
      expect.arrayContaining([
        TASK_METADATA_TYPE.TASK_BEHAVIOR_CODE,
        TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
        TASK_METADATA_TYPE.CURRENT_STATE,
        TASK_METADATA_TYPE.REMINDER_CHANNEL,
      ]),
    );
  });

  it('enriches task card labels from registry only', () => {
    const labels = enrichRuntimeTaskLabels(task, lookup);
    expect(labels).toMatchObject({
      taskBehaviorCodeLabel: 'Metric Check-in',
      assignedToTypeLabel: 'Patient',
      currentStateLabel: 'Active',
      reminderChannelLabels: 'Push Notification, SMS',
    });
  });

  it('attaches metadataLabels on enriched card', () => {
    const enriched = enrichRuntimeTaskCard(task, lookup);
    expect(enriched.metadataLabels.taskBehaviorCodeLabel).toBe('Metric Check-in');
    expect(enriched.taskBehaviorCode).toBe('METRIC_CHECKIN');
  });

  it('enriches task status summary readiness labels', () => {
    const enriched = enrichTaskStatusSummaryLabels(
      { readinessStatus: 'ready', workflowStage: 'onboarding' },
      lookup,
    );
    expect(enriched.metadataLabels.readinessStatusLabel).toBe('Ready');
  });
});
