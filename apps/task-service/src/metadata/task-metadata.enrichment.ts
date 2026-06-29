import {
  TASK_FIELD_TO_METADATA_TYPE,
  TASK_METADATA_TYPE,
  type TaskMetadataFieldKey,
} from './task-metadata.constants';
import type { MetadataValuesByTypesResultDto } from './task-metadata.dto';

export type MetadataLabelLookup = Map<string, Map<string, string>>;

/** Index registry rows by metadata type → valueCode (as returned by metadata-registry API). */
export function buildMetadataLabelLookup(result: MetadataValuesByTypesResultDto): MetadataLabelLookup {
  const lookup: MetadataLabelLookup = new Map();
  for (const item of result.items ?? []) {
    const typeMap = new Map<string, string>();
    for (const value of item.values ?? []) {
      if (String(value.status).toLowerCase() !== 'active') continue;
      const valueCode = String(value.valueCode ?? '').trim();
      if (!valueCode) continue;
      typeMap.set(valueCode, value.label);
    }
    lookup.set(item.metadataType, typeMap);
  }
  return lookup;
}

/** Resolves label when task wire value matches registry valueCode (exact, then case-insensitive). */
export function resolveLabel(
  lookup: MetadataLabelLookup,
  metadataType: string,
  wireValue: string | undefined | null,
): string | undefined {
  if (!wireValue?.trim()) return undefined;
  const typeMap = lookup.get(metadataType);
  if (!typeMap) return undefined;

  const trimmed = wireValue.trim();
  const exact = typeMap.get(trimmed);
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  for (const [valueCode, label] of typeMap) {
    if (valueCode.toLowerCase() === lower) return label;
  }
  return undefined;
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
  currentState?: string;
  surfaceSection?: string;
  transitionSource?: string;
  reminderStatus?: string;
  readinessStatus?: string;
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
  'currentState',
  'surfaceSection',
  'transitionSource',
  'reminderStatus',
  'readinessStatus',
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
      labels[`${field}Label`] = label;
    }
  }

  const channels = task.reminderSettings?.channels;
  if (channels?.length) {
    const channelLabels = channels
      .map((channel) => resolveLabel(lookup, TASK_METADATA_TYPE.REMINDER_CHANNEL, channel))
      .filter((label): label is string => !!label);
    if (channelLabels.length) {
      labels.reminderChannelLabels = channelLabels.join(', ');
    }
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

export function enrichTaskStatusSummaryLabels<
  T extends { readinessStatus?: string; workflowStage?: string },
>(summary: T, lookup: MetadataLabelLookup): T & { metadataLabels: EnrichedRuntimeTaskLabels } {
  const metadataLabels = enrichRuntimeTaskLabels(
    {
      readinessStatus: summary.readinessStatus,
      workflowStage: summary.workflowStage,
    },
    lookup,
  );
  return { ...summary, metadataLabels };
}
