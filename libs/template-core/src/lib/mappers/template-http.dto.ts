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
  version: number;
  status: string;
  isActive: boolean;
  publishedAt?: string | null;
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
    version: meta.version ?? 1,
    status: meta.status ?? 'DRAFT',
    isActive: meta.isActive ?? true,
    publishedAt: meta.publishedAt ?? null,
  };
}
