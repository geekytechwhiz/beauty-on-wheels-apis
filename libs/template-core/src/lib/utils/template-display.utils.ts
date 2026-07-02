import {
  TEMPLATE_FIELD_DISPLAY_LABELS,
  TEMPLATE_STATUS,
  TEMPLATE_STATUS_DISPLAY_LABEL,
  type TemplateStatus,
} from '../constants/template.constants';
import type { TemplateHistoryEntry } from '../mappers/template-http.dto';
import { formatTemplateVersionLabel } from './template.utils';

/** Sentinel returned when a field value is too complex for inline before/after text. */
export const TEMPLATE_DISPLAY_VALUE_UPDATED = 'updated';

export function humanizeTemplateFieldKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim();
}

export function formatTemplateStatusLabel(status: string | undefined): string {
  const normalized = (status ?? TEMPLATE_STATUS.DRAFT).trim().toUpperCase() as TemplateStatus;
  return TEMPLATE_STATUS_DISPLAY_LABEL[normalized] ?? humanizeTemplateFieldKey(status ?? '');
}

/**
 * Resolve a console-facing label for a template field key.
 * Prefers catalog labels, then fieldValues.labelKey, then humanized key.
 */
export function resolveTemplateFieldLabel(
  key: string,
  fieldValues?: Record<string, unknown>,
): string {
  const catalogLabel = TEMPLATE_FIELD_DISPLAY_LABELS[key];
  if (catalogLabel) {
    return catalogLabel;
  }
  const raw = fieldValues?.[key];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const labelKey = (raw as Record<string, unknown>).labelKey;
    if (typeof labelKey === 'string' && labelKey.trim()) {
      return labelKey.trim();
    }
  }
  return humanizeTemplateFieldKey(key);
}

/** Format a template field value for history, adopt preview, and audit messages. */
export function formatTemplateDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value
      .map((item) => formatTemplateDisplayValue(item))
      .filter((part) => part !== '—')
      .join(', ');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.labelKey === 'string' && obj.labelKey.trim()) {
    return obj.labelKey.trim();
  }
  if (typeof obj.title === 'string' && obj.title.trim()) {
    const title = obj.title.trim();
    const version =
      typeof obj.version === 'string' || typeof obj.version === 'number' ? ` v${obj.version}` : '';
    return `${title}${version}`;
  }
  if (typeof obj.sectionName === 'string' && obj.sectionName.trim()) {
    return obj.sectionName.trim();
  }
  if (
    typeof obj.value === 'string' ||
    typeof obj.value === 'number' ||
    typeof obj.value === 'boolean'
  ) {
    return formatTemplateDisplayValue(obj.value);
  }
  return TEMPLATE_DISPLAY_VALUE_UPDATED;
}

export function isComplexTemplateFieldValue(value: unknown): boolean {
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

export function buildTemplateFieldChangeMessages(
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

    const label = resolveTemplateFieldLabel(key, current);
    const complex = isComplexTemplateFieldValue(before) || isComplexTemplateFieldValue(after);

    if (before === undefined) {
      messages.push(
        complex
          ? `'${label}' was added.`
          : `'${label}' set to ${formatTemplateDisplayValue(after)}.`,
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
      `'${label}' changed from ${formatTemplateDisplayValue(before)} to ${formatTemplateDisplayValue(after)}.`,
    );
  }

  return messages;
}

export function buildTemplateHistoryMetaChangeMessages(
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
      `Status changed from ${formatTemplateStatusLabel(previous.status)} to ${formatTemplateStatusLabel(current.status)}.`,
    );
  }
  if (previous.isActive !== current.isActive) {
    messages.push(
      `Active changed from ${formatTemplateDisplayValue(previous.isActive)} to ${formatTemplateDisplayValue(current.isActive)}.`,
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
              ...buildTemplateHistoryMetaChangeMessages(previous, entry),
              ...buildTemplateFieldChangeMessages(
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
