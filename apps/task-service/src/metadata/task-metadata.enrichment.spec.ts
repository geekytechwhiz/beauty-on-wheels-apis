import { TASK_METADATA_TYPE } from './task-metadata.constants';
import type { MetadataValuesByTypesResultDto } from './task-metadata.dto';
import {
  buildMetadataLabelLookup,
  collectMetadataTypesFromTask,
  enrichRuntimeTaskCard,
  enrichRuntimeTaskLabels,
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
        metadataType: TASK_METADATA_TYPE.TASK_BEHAVIOR,
        values: [{ valueCode: 'METRIC_CHECKIN', label: 'Metric check-in', status: 'active' }],
      },
      {
        metadataType: TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
        values: [{ valueCode: 'patient', label: 'Patient', status: 'active' }],
      },
      {
        metadataType: TASK_METADATA_TYPE.REMINDER_CHANNEL,
        values: [
          { valueCode: 'PUSH', label: 'Push', status: 'active' },
          { valueCode: 'SMS', label: 'SMS', status: 'active' },
        ],
      },
    ],
    missingMetadataTypeCodes: [],
  });

  const task = {
    taskBehaviorCode: 'METRIC_CHECKIN',
    assignedToType: 'patient',
    reminderSettings: { channels: ['push', 'sms'] },
  };

  it('builds label lookup and resolves labels', () => {
    expect(resolveLabel(lookup, TASK_METADATA_TYPE.TASK_BEHAVIOR, 'METRIC_CHECKIN')).toBe('Metric check-in');
    expect(resolveLabel(lookup, TASK_METADATA_TYPE.REMINDER_CHANNEL, 'push')).toBe('Push');
  });

  it('skips inactive registry values', () => {
    const inactiveLookup = buildMetadataLabelLookup(
      registryFixture([
        {
          type: TASK_METADATA_TYPE.TASK_BEHAVIOR,
          codes: [{ code: 'OLD_CODE', label: 'Old', status: 'inactive' }],
        },
      ]),
    );
    expect(resolveLabel(inactiveLookup, TASK_METADATA_TYPE.TASK_BEHAVIOR, 'OLD_CODE')).toBeUndefined();
  });

  it('collects metadata types present on a task card', () => {
    expect(collectMetadataTypesFromTask(task)).toEqual(
      expect.arrayContaining([
        TASK_METADATA_TYPE.TASK_BEHAVIOR,
        TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
        TASK_METADATA_TYPE.REMINDER_CHANNEL,
      ]),
    );
  });

  it('enriches task card labels', () => {
    const labels = enrichRuntimeTaskLabels(task, lookup);
    expect(labels).toMatchObject({
      taskBehaviorCodeLabel: 'Metric check-in',
      assignedToTypeLabel: 'Patient',
      reminderChannelLabels: 'Push, SMS',
    });
  });

  it('attaches metadataLabels on enriched card', () => {
    const enriched = enrichRuntimeTaskCard(task, lookup);
    expect(enriched.metadataLabels.taskBehaviorCodeLabel).toBe('Metric check-in');
    expect(enriched.taskBehaviorCode).toBe('METRIC_CHECKIN');
  });
});
