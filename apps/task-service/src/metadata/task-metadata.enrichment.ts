import { normalizeMetadataLookupKey } from './task-metadata.codes';
import {
  TASK_FIELD_TO_METADATA_TYPE,
  TASK_METADATA_LABEL_FIELDS,
  TASK_METADATA_TYPE,
  type TaskMetadataFieldKey,
} from './task-metadata.constants';
import type { MetadataValuesByTypesResultDto } from './task-metadata.dto';

export type MetadataLabelLookup = Map<string, Map<string, string>>;

export function buildMetadataLabelLookup(result: MetadataValuesByTypesResultDto): MetadataLabelLookup {
  const lookup: MetadataLabelLookup = new Map();
  for (const item of result.items ?? []) {
    const typeMap = new Map<string, string>();
    for (const value of item.values ?? []) {
      if (String(value.status).toLowerCase() !== 'active') continue;
      const key = normalizeMetadataLookupKey(item.metadataType, value.valueCode);
      typeMap.set(key, value.label);
    }
    lookup.set(item.metadataType, typeMap);
  }
  return lookup;
}

export function resolveLabel(
  lookup: MetadataLabelLookup,
  metadataType: string,
  wireValue: string | undefined | null,
): string | undefined {
  if (!wireValue) return undefined;
  const normalized = normalizeMetadataLookupKey(metadataType, wireValue);
  return lookup.get(metadataType)?.get(normalized);
}

export type EnrichedRuntimeTaskLabels = Partial<Record<string, string>>;

export interface RuntimeTaskLabelSource {
  taskBehaviorCode?: string;
  taskDisplayGroup?: string;
  assignedToType?: string;
  workflowStage?: string;
  taskGenerationTrigger?: string;
  completionSourceType?: string | null;
  runtimeTaskSource?: string;
  reminderSettings?: { channels?: string[] } | null;
}

const CARD_LABEL_FIELDS: TaskMetadataFieldKey[] = [
  'taskBehaviorCode',
  'taskDisplayGroup',
  'assignedToType',
  'workflowStage',
  'taskGenerationTrigger',
  'completionSourceType',
  'runtimeTaskSource',
];

export function collectMetadataTypesFromTask(task: RuntimeTaskLabelSource): string[] {
  const types = new Set<string>();
  for (const field of CARD_LABEL_FIELDS) {
    const value = task[field as keyof RuntimeTaskLabelSource];
    if (typeof value === 'string' && value.trim()) {
      types.add(TASK_FIELD_TO_METADATA_TYPE[field]);
    }
  }
  if (task.reminderSettings?.channels?.length) {
    types.add(TASK_METADATA_TYPE.REMINDER_CHANNEL);
  }
  return [...types];
}

export function collectMetadataTypesFromTasks(tasks: RuntimeTaskLabelSource[]): string[] {
  const types = new Set<string>();
  for (const task of tasks) {
    for (const type of collectMetadataTypesFromTask(task)) {
      types.add(type);
    }
  }
  return [...types];
}

export function enrichRuntimeTaskLabels(
  task: RuntimeTaskLabelSource,
  lookup: MetadataLabelLookup,
): EnrichedRuntimeTaskLabels {
  const labels: EnrichedRuntimeTaskLabels = {};

  for (const field of CARD_LABEL_FIELDS) {
    const value = task[field as keyof RuntimeTaskLabelSource];
    if (typeof value !== 'string' || !value.trim()) continue;
    const metadataType = TASK_FIELD_TO_METADATA_TYPE[field];
    const label = resolveLabel(lookup, metadataType, value);
    if (label) {
      labels[TASK_METADATA_LABEL_FIELDS[field]] = label;
    }
  }

  const channels = task.reminderSettings?.channels;
  if (channels?.length) {
    labels.reminderChannelLabels = channels
      .map((channel) => resolveLabel(lookup, TASK_METADATA_TYPE.REMINDER_CHANNEL, channel) ?? channel)
      .join(', ');
  }

  return labels;
}

export function enrichRuntimeTaskCard<T extends RuntimeTaskLabelSource>(
  task: T,
  lookup: MetadataLabelLookup,
): T & { metadataLabels: EnrichedRuntimeTaskLabels } {
  return {
    ...task,
    metadataLabels: enrichRuntimeTaskLabels(task, lookup),
  };
}

export function enrichRuntimeTaskCards<T extends RuntimeTaskLabelSource>(
  tasks: T[],
  lookup: MetadataLabelLookup,
): Array<T & { metadataLabels: EnrichedRuntimeTaskLabels }> {
  return tasks.map((task) => enrichRuntimeTaskCard(task, lookup));
}
