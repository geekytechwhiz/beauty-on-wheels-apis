import { TASK_METADATA_TYPE } from '../metadata';

import { TaskMetadataService } from './task-metadata.service';

describe('TaskMetadataService', () => {
  const registry = {
    items: [
      {
        metadataType: TASK_METADATA_TYPE.TASK_BEHAVIOR,
        values: [{ valueCode: 'METRIC_CHECKIN', label: 'Metric check-in', status: 'active' }],
      },
      {
        metadataType: TASK_METADATA_TYPE.ASSIGNED_TO_TYPE,
        values: [{ valueCode: 'patient', label: 'Patient', status: 'active' }],
      },
    ],
    missingMetadataTypeCodes: [],
  };

  const reader = {
    getValuesByTypes: jest.fn().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(registry), 50);
    })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reader.getValuesByTypes.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(registry), 50);
    }));
  });

  it('enriches task with lookup started before loadTask (parallel registry fetch)', async () => {
    const service = new TaskMetadataService({ reader });
    const lookupPromise = service.beginLabelLookupForWrite(
      'postMonitoringAction',
      { taskBehaviorCode: 'METRIC_CHECKIN', assignedToType: 'patient' },
      'Bearer token',
    );

    expect(reader.getValuesByTypes).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const task = await service.enrichTaskWithLookup(
      { taskBehaviorCode: 'METRIC_CHECKIN', assignedToType: 'patient' },
      lookupPromise,
    );

    expect(task.metadataLabels).toMatchObject({
      taskBehaviorCodeLabel: 'Metric check-in',
      assignedToTypeLabel: 'Patient',
    });
    expect(reader.getValuesByTypes).toHaveBeenCalledWith(
      {
        metadataTypeCodes: [TASK_METADATA_TYPE.TASK_BEHAVIOR, TASK_METADATA_TYPE.ASSIGNED_TO_TYPE],
      },
      'Bearer token',
    );
  });

  it('enrichAfterWrite runs registry fetch in parallel with loadTask', async () => {
    const service = new TaskMetadataService({ reader });
    let loadResolvedAt = 0;

    const enriched = await service.enrichAfterWrite(
      'postMonitoringAction',
      { taskBehaviorCode: 'METRIC_CHECKIN', assignedToType: 'patient' },
      'Bearer token',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        loadResolvedAt = Date.now();
        return { taskBehaviorCode: 'METRIC_CHECKIN', assignedToType: 'patient' };
      },
    );

    expect(enriched.metadataLabels.taskBehaviorCodeLabel).toBe('Metric check-in');
    expect(loadResolvedAt).toBeGreaterThan(0);
  });
});
