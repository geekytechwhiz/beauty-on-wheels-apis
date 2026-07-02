import type { TemplateHistoryEntry } from '../mappers/template-http.dto';
import { formatTemplateVersionLabel } from './template.utils';

/** Console-facing labels for common care-plan / org template field keys. */
const TEMPLATE_FIELD_LABELS: Record<string, string> = {
  TEMPLATE_NAME: 'Template name',
  LinkedTaskTemplate: 'Linked task templates',
  LinkedGoalTemplate: 'Linked goal template',
  LinkedMonitoringTemplate: 'Linked monitoring template',
  ReviewCadence: 'Review cadence',
  DefaultDurationType: 'Default duration',
  DurationType: 'Duration options',
  MaxGoalsAllowed: 'Max goals allowed',
  GoalsEnabled: 'Goals',
  BillingProgramTypes: 'Billing program types',
  baselineSections: 'Baseline sections',
  EducationHub: 'Education hub',
  TaskTemplateIntro: 'Task template intro',
  CustomDurationAllowed: 'Custom duration',
  Category: 'Category',
  Condition: 'Condition',
  Country: 'Country',
  Language: 'Language',
  Specialty: 'Specialty',
  SelectScope: 'Scope',
  IcdCode: 'ICD codes',
};

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim();
}

function humanizeStatus(status: string | undefined): string {
  const normalized = (status ?? '').trim().toLowerCase();
  if (normalized === 'draft') return 'Draft';
  if (normalized === 'published') return 'Published';
  return status?.trim() || '—';
}

export function formatHistoryValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value
      .map((item) => formatHistoryValue(item))
      .filter((part) => part !== '—')
      .join(', ');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.labelKey === 'string' && obj.labelKey.trim()) {
    return obj.labelKey.trim();
  }
  if (typeof obj.title === 'string' && obj.title.trim()) {
    const title = obj.title.trim();
    const version = typeof obj.version === 'string' || typeof obj.version === 'number' ? ` v${obj.version}` : '';
    return `${title}${version}`;
  }
  if (typeof obj.sectionName === 'string' && obj.sectionName.trim()) {
    return obj.sectionName.trim();
  }
  if (typeof obj.value === 'string' || typeof obj.value === 'number' || typeof obj.value === 'boolean') {
    return formatHistoryValue(obj.value);
  }
  return 'Updated';
}

function isComplexHistoryValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => item !== null && typeof item === 'object');
  }
  const obj = value as Record<string, unknown>;
  return !(
    typeof obj.value === 'string' ||
    typeof obj.value === 'number' ||
    typeof obj.value === 'boolean' ||
    (typeof obj.labelKey === 'string' && Object.keys(obj).length <= 2)
  );
}

export function templateFieldLabel(key: string): string {
  return TEMPLATE_FIELD_LABELS[key] ?? humanizeKey(key);
}

export function buildHistoryFieldChangeMessages(
  previous: Record<string, unknown> | undefined,
  current: Record<string, unknown> | undefined,
): string[] {
  if (!current) return [];
  const prev = previous ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(current)]);
  const messages: string[] = [];

  for (const key of keys) {
    const before = prev[key];
    const after = current[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    const label = templateFieldLabel(key);
    const complex = isComplexHistoryValue(before) || isComplexHistoryValue(after);

    if (before === undefined) {
      messages.push(
        complex
          ? `'${label}' was added.`
          : `'${label}' set to ${formatHistoryValue(after)}.`,
      );
      continue;
    }
    if (after === undefined) {
      messages.push(`'${label}' was removed.`);
      continue;
    }
    if (complex) {
      messages.push(`'${label}' was updated.`);
      continue;
    }
    messages.push(
      `'${label}' changed from ${formatHistoryValue(before)} to ${formatHistoryValue(after)}.`,
    );
  }

  return messages;
}

export function buildHistoryMetaChangeMessages(
  previous: TemplateHistoryEntry | undefined,
  current: TemplateHistoryEntry,
): string[] {
  if (!previous) return [];
  const messages: string[] = [];

  if (previous.version !== current.version) {
    messages.push(
      `Version updated from ${formatTemplateVersionLabel(previous.version)} to ${formatTemplateVersionLabel(current.version)}.`,
    );
  }
  if (previous.status !== current.status) {
    messages.push(
      `Status changed from ${humanizeStatus(previous.status)} to ${humanizeStatus(current.status)}.`,
    );
  }
  if (previous.isActive !== current.isActive) {
    messages.push(
      `Active changed from ${formatHistoryValue(previous.isActive)} to ${formatHistoryValue(current.isActive)}.`,
    );
  }
  if (current.notes && current.notes !== previous.notes) {
    messages.push(current.notes);
  }

  return messages;
}

/** Strip internal snapshots and return human-readable timeline for API responses. */
export function formatHistoryEntriesForApi(entries: TemplateHistoryEntry[]): TemplateHistoryEntry[] {
  if (entries.length === 0) return [];

  const asc = [...entries].sort((a, b) => a.version - b.version);
  const formatted = asc.map((entry, index) => {
    const previous = index > 0 ? asc[index - 1] : undefined;
    const hasSnapshots =
      !!entry.fieldValues ||
      !!previous?.fieldValues ||
      (index > 0 &&
        (previous?.version !== entry.version ||
          previous?.status !== entry.status ||
          previous?.isActive !== entry.isActive ||
          (entry.notes && entry.notes !== previous?.notes)));

    const changes =
      index === 0
        ? []
        : hasSnapshots
          ? [
              ...buildHistoryMetaChangeMessages(previous, entry),
              ...buildHistoryFieldChangeMessages(
                previous?.fieldValues as Record<string, unknown> | undefined,
                entry.fieldValues as Record<string, unknown> | undefined,
              ),
            ]
          : (entry.changes ?? []);

    const apiEntry: TemplateHistoryEntry = { ...entry, changes };
    delete apiEntry.fieldValues;
    delete apiEntry.rules;
    return apiEntry;
  });

  return formatted.sort((a, b) => b.version - a.version);
}
