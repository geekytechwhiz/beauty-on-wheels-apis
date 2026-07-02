import type { TemplateActorUser } from '../models/template-actor.model';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { normalizeTemplateActor } from '../utils/template-actor.utils';
import { firstString, resolveMasterTemplateIsActive, sanitizeMetaForApi } from '../utils/template.utils';
import {
  TEMPLATE_HISTORY_STATUS_ACTION,
  TEMPLATE_HISTORY_STATUS_TITLE,
  TEMPLATE_STATUS,
  type TemplateStatus,
} from '../constants/template.constants';
import {
  buildTemplateFieldChangeMessages,
  buildTemplateHistoryMetaChangeMessages,
  formatHistoryEntriesForApi,
} from '../utils/template-display.utils';

export interface TemplateSummaryData {
  templateId: string;
  templateVersionId: string;
  version: number;
  status: string;
  schemaRef?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  publishedAt?: string | null;
}

export interface TemplateVersionSummary {
  templateId: string;
  templateVersionId: string;
  organizationId: string | null;
  version: number;
  status: string;
  isActive: boolean;
  publishedAt?: string | null;
  createdAt?: string | null;
  schemaRef?: string | null;
}

export interface OrgTemplateListItem {
  templateId: string;
  templateVersionId: string;
  templateName?: string;
  organizationId: string;
  masterTemplateId?: string | null;
  masterTemplateVersionId?: string | null;
  templateType?: string;
  templateEnabled: boolean;
  condition?: string;
  version: number;
  status: string;
  derivedFromTemplateVersionId?: string | null;
  updatedAt?: string | null;
}

export interface MasterTemplateListItem {
  templateId: string;
  templateVersionId: string;
  templateName?: string;
  templateType?: string;
  countries?: string[];
  languages?: string[];
  version: number;
  status: string;
  isActive: boolean;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: TemplateActorUser | null;
  /** Full field payload as sent on create/update (round-trips create -> read). */
  fieldValues?: Record<string, unknown>;
  /** Version timeline for this template (newest first). */
  history?: TemplateHistoryEntry[];
}

export interface TemplateHistoryEntry {
  version: number;
  templateVersionId: string;
  status: string;
  /** Machine-friendly action derived from status/version. */
  action: string;
  /** Human-friendly label for the timeline (e.g. "Template Published"). */
  title: string;
  isActive: boolean;
  isLatestVersion: boolean;
  updatedAt?: string | null;
  updatedBy?: TemplateActorUser | null;
  createdAt?: string | null;
  publishedAt?: string | null;
  publishedBy?: TemplateActorUser | null;
  /** Reviewer/lifecycle note when present (reviewComments). */
  notes?: string | null;
  /** Field-level diffs vs the previous history entry. */
  changes: string[];
  /** Snapshot of fieldValues at this point in time (for diffing). */
  fieldValues?: Record<string, unknown>;
  /** Snapshot of rules at this point in time (for org-derived adopt). */
  rules?: Record<string, unknown>;
}

function diffFieldValues(
  previous: Record<string, unknown> | undefined,
  current: Record<string, unknown> | undefined,
): string[] {
  return buildTemplateFieldChangeMessages(previous, current);
}

function diffHistoryMeta(
  previous: TemplateHistoryEntry | undefined,
  current: TemplateHistoryEntry,
): string[] {
  return buildTemplateHistoryMetaChangeMessages(previous, current);
}

/** API responses omit internal snapshots and return human-readable change messages. */
export function sanitizeHistoryForApi(entries: TemplateHistoryEntry[]): TemplateHistoryEntry[] {
  return formatHistoryEntriesForApi(entries);
}

/** List/detail endpoints: timeline metadata only — no rules or fieldValues snapshots. */
export function toListHistorySummary(entries: TemplateHistoryEntry[]): TemplateHistoryEntry[] {
  return formatHistoryEntriesForApi(entries);
}

export function toTemplateSummary(record: TemplateDdbRecord): TemplateSummaryData {
  const meta = record.meta;
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    schemaRef: record.schemaRef ?? null,
    createdAt: meta.createdAt,
    updatedAt: meta.lastModifiedAt ?? null,
    publishedAt: meta.publishedAt ?? null,
  };
}

export function toOrgVersionSummary(
  record: TemplateDdbRecord,
  organizationId: string,
): TemplateVersionSummary {
  const meta = record.meta;
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    organizationId,
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    isActive: meta.isActive ?? true,
    publishedAt: meta.publishedAt ?? null,
    createdAt: meta.createdAt ?? null,
    schemaRef: record.schemaRef ?? null,
  };
}

export function toOrgListItem(
  record: TemplateDdbRecord,
  organizationId: string,
): OrgTemplateListItem {
  const meta = record.meta;
  const masterTemplateId =
    (meta.masterTemplateId as string | undefined) ??
    (meta.derivedFromTemplateVersionId as string | undefined)?.replace(/-V\d+$/i, '') ??
    null;
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    templateName: meta.templateName,
    organizationId,
    masterTemplateId,
    masterTemplateVersionId:
      (meta.masterTemplateVersionId as string | undefined) ??
      (meta.derivedFromTemplateVersionId as string | undefined) ??
      null,
    templateType: meta.templateType,
    templateEnabled: true,
    condition: firstString(meta.condition ?? meta.conditions),
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    derivedFromTemplateVersionId:
      (meta.derivedFromTemplateVersionId as string | undefined) ?? null,
    updatedAt: meta.lastModifiedAt ?? null,
  };
}

export function toVersionSummary(record: TemplateDdbRecord): TemplateVersionSummary {
  const meta = record.meta;
  const orgId =
    typeof meta.ownerOrgId === 'string' && meta.ownerOrgId.trim()
      ? meta.ownerOrgId.trim()
      : null;
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    organizationId: orgId,
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    isActive: meta.isActive ?? true,
    publishedAt: meta.publishedAt ?? null,
    createdAt: meta.createdAt ?? null,
    schemaRef: record.schemaRef ?? null,
  };
}

export function toMasterListItem(record: TemplateDdbRecord): MasterTemplateListItem {
  const meta = record.meta;
  const status = meta.status ?? TEMPLATE_STATUS.DRAFT;
  const fieldValues =
    record.fieldValues && typeof record.fieldValues === 'object' && !Array.isArray(record.fieldValues)
      ? (record.fieldValues as Record<string, unknown>)
      : undefined;
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    templateName: meta.templateName,
    templateType: meta.templateType,
    templateDescription: meta.templateDescription,
    countries: meta.countries,
    languages: meta.languages,
    version: meta.version ?? 1,
    status,
    isActive: resolveMasterTemplateIsActive(meta),
    publishedAt: meta.publishedAt ?? null,
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.lastModifiedAt ?? null,
    updatedBy: normalizeTemplateActor(meta.lastModifiedBy) ?? null,
    ...(fieldValues ? { fieldValues } : {}),
  };
}

const HISTORY_STATUS_TITLE = TEMPLATE_HISTORY_STATUS_TITLE;
const HISTORY_STATUS_ACTION = TEMPLATE_HISTORY_STATUS_ACTION;

/** Build a single version-history timeline entry from a stored VERSION row. */
export function toHistoryEntry(record: TemplateDdbRecord, isLowestVersion: boolean): TemplateHistoryEntry {
  const meta = record.meta;
  const status = (meta.status ?? TEMPLATE_STATUS.DRAFT) as string;
  const statusKey = status.trim().toUpperCase() as TemplateStatus;
  const notes = (firstString(meta.reviewComments) as string | undefined) ?? null;
  const isCreate = isLowestVersion;
  return {
    version: meta.version ?? 1,
    templateVersionId: meta.templateVersionId,
    status,
    action: isCreate ? 'CREATED' : HISTORY_STATUS_ACTION[statusKey] ?? 'UPDATED',
    title: isCreate ? 'Template Created' : HISTORY_STATUS_TITLE[statusKey] ?? 'Template Updated',
    isActive: meta.isActive ?? true,
    isLatestVersion: meta.isLatestVersion ?? false,
    updatedAt: meta.lastModifiedAt ?? null,
    updatedBy: normalizeTemplateActor(meta.lastModifiedBy) ?? null,
    createdAt: meta.createdAt ?? null,
    publishedAt: meta.publishedAt ?? null,
    publishedBy: normalizeTemplateActor(meta.publishedBy) ?? null,
    notes,
    changes: notes ? [notes] : [],
  };
}

/** True when a history entry belongs to the given org/master template id (not another variant). */
export function templateVersionBelongsToTemplate(
  templateId: string,
  templateVersionId: string | undefined,
): boolean {
  if (!templateId.trim() || !templateVersionId?.trim()) return false;
  return templateVersionId.trim().startsWith(`${templateId.trim()}-`);
}

export function filterHistoryForTemplate(
  templateId: string,
  entries: TemplateHistoryEntry[],
): TemplateHistoryEntry[] {
  return entries.filter((entry) =>
    templateVersionBelongsToTemplate(templateId, entry.templateVersionId),
  );
}

/** Persist timeline on the VERSION row (in-place edits overwrite the row; history is appended here). */
export function appendVersionHistoryToRecord(
  record: TemplateDdbRecord,
  opts?: { isCreate?: boolean },
): void {
  const existing = Array.isArray(record.versionHistory)
    ? (record.versionHistory as TemplateHistoryEntry[])
    : [];
  const fv =
    record.fieldValues && typeof record.fieldValues === 'object' && !Array.isArray(record.fieldValues)
      ? (record.fieldValues as Record<string, unknown>)
      : undefined;
  const previous = existing[0];
  const isCreate = opts?.isCreate ?? existing.length === 0;
  const entry = toHistoryEntry(record, isCreate);
  entry.fieldValues = fv ? { ...fv } : undefined;
  const rules =
    record.rules && typeof record.rules === 'object' && !Array.isArray(record.rules)
      ? (record.rules as Record<string, unknown>)
      : undefined;
  entry.rules = rules ? { ...rules } : undefined;
  if (isCreate) {
    entry.changes = [];
  } else {
    const fieldChanges = diffFieldValues(previous?.fieldValues, entry.fieldValues);
    const metaChanges = diffHistoryMeta(previous, entry);
    entry.changes = [...metaChanges, ...fieldChanges];
    if (entry.notes && !entry.changes.includes(`note: ${entry.notes}`)) {
      entry.changes.push(`note: ${entry.notes}`);
    }
  }
  entry.isLatestVersion = true;
  const templateId = record.meta?.templateId?.trim();
  const prior = existing
    .filter((h) =>
      templateId
        ? templateVersionBelongsToTemplate(templateId, h.templateVersionId)
        : true,
    )
    .map((h) => ({ ...h, isLatestVersion: false }));
  record.versionHistory = [entry, ...prior].sort((a, b) => b.version - a.version);
}

/** Prefer stored `versionHistory`; fall back to VERSION rows when present. */
export function resolveTemplateHistory(
  rep: TemplateDdbRecord,
  allVersionsForTemplate: TemplateDdbRecord[],
): TemplateHistoryEntry[] {
  const templateId = rep.meta?.templateId?.trim();
  if (Array.isArray(rep.versionHistory) && rep.versionHistory.length > 0) {
    const sanitized = sanitizeHistoryForApi(rep.versionHistory as TemplateHistoryEntry[]);
    const scoped = templateId ? filterHistoryForTemplate(templateId, sanitized) : sanitized;
    if (scoped.length > 0) {
      return scoped;
    }
  }
  if (allVersionsForTemplate.length > 0) {
    return sanitizeHistoryForApi(buildVersionHistory(allVersionsForTemplate));
  }
  return [];
}

/** Group all VERSION rows by templateId and build a history timeline per template. */
export function buildHistoryByTemplateId(
  records: TemplateDdbRecord[],
): Map<string, TemplateHistoryEntry[]> {
  const byTemplate = new Map<string, TemplateDdbRecord[]>();
  for (const row of records) {
    const id = row.meta?.templateId;
    if (!id) continue;
    const list = byTemplate.get(id) ?? [];
    list.push(row);
    byTemplate.set(id, list);
  }
  const out = new Map<string, TemplateHistoryEntry[]>();
  for (const [templateId, versions] of byTemplate) {
    out.set(templateId, buildVersionHistory(versions));
  }
  return out;
}

/** Build a version-history timeline (newest first) from VERSION rows of one template. */
export function buildVersionHistory(records: TemplateDdbRecord[]): TemplateHistoryEntry[] {
  const sortedAsc = [...records].sort((a, b) => (a.meta.version ?? 0) - (b.meta.version ?? 0));
  const lowestVersion = sortedAsc[0]?.meta.version ?? 1;
  return sortedAsc
    .map((row) => toHistoryEntry(row, (row.meta.version ?? 1) === lowestVersion))
    .sort((a, b) => b.version - a.version);
}

const MASTER_RECORD_SYSTEM_KEYS = new Set([
  'pk',
  'sk',
  'entityType',
  'meta',
  'gsi1pk',
  'gsi1sk',
  'gsi2pk',
  'gsi2sk',
  'gsi3pk',
  'gsi3sk',
  'gsi4pk',
  'gsi4sk',
  'gsi5pk',
  'gsi5sk',
]);

/** Persisted on VERSION rows but omitted from HTTP responses. */
const MASTER_RECORD_INTERNAL_KEYS = new Set(['rules']);

/**
 * Full master template document for list/detail reads — returns stored VERSION shape
 * (`meta`, `templateMetadata`, `templateProfile`, type sections) as persisted.
 */
export function toMasterFullRecord(record: TemplateDdbRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pk: record.pk,
    sk: record.sk,
    entityType: record.entityType,
    meta: sanitizeMetaForApi(record.meta),
  };

  if (record.schemaRef !== undefined) out.schemaRef = record.schemaRef;
  if (record.schemaHash !== undefined) out.schemaHash = record.schemaHash;
  if (record.schemaSize !== undefined) out.schemaSize = record.schemaSize;

  for (const [key, value] of Object.entries(record)) {
    if (MASTER_RECORD_SYSTEM_KEYS.has(key) || MASTER_RECORD_INTERNAL_KEYS.has(key)) continue;
    if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
}
