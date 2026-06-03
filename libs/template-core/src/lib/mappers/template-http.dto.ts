import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { firstString } from '../utils/template.utils';

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
  category?: string;
  condition?: string;
  countries?: string[];
  languages?: string[];
  shareScope?: string | null;
  version: number;
  status: string;
  isActive: boolean;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
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
  updatedBy?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
  publishedBy?: string | null;
  /** Reviewer/lifecycle note when present (reviewComments). */
  notes?: string | null;
  /** Best-effort change bullets (currently derived from notes; empty when none stored). */
  changes: string[];
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
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    templateName: meta.templateName,
    organizationId,
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
  return {
    templateId: meta.templateId,
    templateVersionId: meta.templateVersionId,
    templateName: meta.templateName,
    templateType: meta.templateType,
    category: firstString(meta.category),
    condition: firstString(meta.condition ?? meta.conditions),
    countries: meta.countries,
    languages: meta.languages,
    shareScope: (firstString(meta.shareScope) as string | undefined) ?? null,
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    isActive: meta.isActive ?? true,
    publishedAt: meta.publishedAt ?? null,
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.lastModifiedAt ?? null,
    updatedBy: (firstString(meta.lastModifiedBy) as string | undefined) ?? null,
  };
}

const HISTORY_STATUS_TITLE: Record<string, string> = {
  DRAFT: 'Template Updated',
  SAVED: 'Template Saved',
  IN_REVIEW: 'Submitted for Review',
  PUBLISHED: 'Template Published',
  ARCHIVED: 'Template Archived',
  DEPRECATED: 'Template Deprecated',
};

const HISTORY_STATUS_ACTION: Record<string, string> = {
  DRAFT: 'UPDATED',
  SAVED: 'SAVED',
  IN_REVIEW: 'SUBMITTED_FOR_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
  DEPRECATED: 'DEPRECATED',
};

/** Build a single version-history timeline entry from a stored VERSION row. */
export function toHistoryEntry(record: TemplateDdbRecord, isLowestVersion: boolean): TemplateHistoryEntry {
  const meta = record.meta;
  const status = (meta.status ?? 'DRAFT') as string;
  const notes = (firstString(meta.reviewComments) as string | undefined) ?? null;
  const isCreate = isLowestVersion;
  return {
    version: meta.version ?? 1,
    templateVersionId: meta.templateVersionId,
    status,
    action: isCreate ? 'CREATED' : HISTORY_STATUS_ACTION[status] ?? 'UPDATED',
    title: isCreate ? 'Template Created' : HISTORY_STATUS_TITLE[status] ?? 'Template Updated',
    isActive: meta.isActive ?? true,
    isLatestVersion: meta.isLatestVersion ?? false,
    updatedAt: meta.lastModifiedAt ?? null,
    updatedBy: (firstString(meta.lastModifiedBy) as string | undefined) ?? null,
    createdAt: meta.createdAt ?? null,
    publishedAt: meta.publishedAt ?? null,
    publishedBy: (firstString(meta.publishedBy) as string | undefined) ?? null,
    notes,
    changes: notes ? [notes] : [],
  };
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

/**
 * Full master template document for list/detail reads — returns stored VERSION shape
 * (`meta`, `templateMetadata`, `templateProfile`, type sections) as persisted.
 */
export function toMasterFullRecord(record: TemplateDdbRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pk: record.pk,
    sk: record.sk,
    entityType: record.entityType,
    meta: record.meta,
  };

  if (record.schemaRef !== undefined) out.schemaRef = record.schemaRef;
  if (record.schemaHash !== undefined) out.schemaHash = record.schemaHash;
  if (record.schemaSize !== undefined) out.schemaSize = record.schemaSize;

  for (const [key, value] of Object.entries(record)) {
    if (MASTER_RECORD_SYSTEM_KEYS.has(key)) continue;
    if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
}
