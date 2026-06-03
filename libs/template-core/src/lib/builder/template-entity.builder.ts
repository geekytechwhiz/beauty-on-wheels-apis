import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_MASTER_TEMPLATE,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  TEMPLATE_TYPE_CARE_PLAN,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { TemplateDdbRecord, TemplateMeta } from '../models/persistence/template-ddb.model';
import { normalizeShareScope } from '../utils/share-scope.utils';
import { firstString } from '../utils/template.utils';
import { TemplateKeyBuilder } from './template-key.builder';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return undefined;
}

/** Top-level create keys duplicated on `meta` — omit from VERSION document root spread. */
const META_BODY_KEYS = [
  'templateCode',
  'templateName',
  'templateType',
  'status',
  'version',
  'templateId',
] as const;

function stripMetaBodyFields(body: Record<string, unknown>): Record<string, unknown> {
  const documentFields = { ...body };
  for (const key of META_BODY_KEYS) {
    delete documentFields[key];
  }
  return documentFields;
}

export type CreateMasterTemplateInput = Record<string, unknown> & {
  templateCode: string;
  templateName: string;
  templateType?: string;
  status?: TemplateStatus;
  version?: number;
  category?: string | string[];
  condition?: string | string[];
  conditions?: string[];
  countries?: string[];
  languages?: string[];
  specialty?: string[];
  specialties?: string[];
  templateDescription?: string;
  createdBy?: string;
};

export interface CreateMasterTemplateContext {
  templateId: string;
  templateVersionId: string;
  versionNum: number;
  versionSk: string;
  nowIso: string;
  input: CreateMasterTemplateInput;
}

export interface MasterVersionWriteContext {
  templateId: string;
  templateVersionId: string;
  versionNum: number;
  versionSk: string;
  nowIso: string;
}

export class TemplateEntityBuilder {
  static normalizeTemplateType(templateType: string): string {
    return templateType.trim().replace(/\s+/g, '_').toUpperCase();
  }

  static normalizeTemplateId(templateCode: string): string {
    const base = templateCode.trim().replace(/_/g, '-').toUpperCase();
    return base || `TMPL-${randomUUID().slice(0, 8)}`;
  }

  /**
   * URL path may be `templateId` (TASK-CODE) or `templateVersionId` (TASK-CODE-V01).
   */
  static resolveMasterPathParam(pathParam: string): {
    templateId: string;
    templateVersionId?: string;
  } {
    const normalized = TemplateEntityBuilder.normalizeTemplateId(pathParam);
    const match = normalized.match(/^(.+)-V(\d{2})$/i);
    if (match) {
      return { templateId: match[1], templateVersionId: normalized };
    }
    return { templateId: normalized };
  }

  static buildVersionId(templateId: string, versionNum: number): string {
    return `${templateId}-V${String(versionNum).padStart(2, '0')}`;
  }

  static buildVersionWriteContext(
    templateId: string,
    versionNum: number,
    nowIso = new Date().toISOString(),
  ): MasterVersionWriteContext {
    const templateVersionId = TemplateEntityBuilder.buildVersionId(templateId, versionNum);
    const versionSk = `${VERSION_SK_PREFIX}${String(versionNum).padStart(3, '0')}`;
    return { templateId, templateVersionId, versionNum, versionSk, nowIso };
  }

  static buildMetaFromExisting(
    existing: TemplateMeta,
    overrides: Partial<TemplateMeta>,
    ctx: MasterVersionWriteContext,
    actorUserId?: string,
  ): TemplateMeta {
    const status = (overrides.status ?? existing.status ?? TEMPLATE_STATUS.DRAFT) as TemplateStatus;
    const isActive =
      overrides.isActive !== undefined
        ? overrides.isActive
        : status !== TEMPLATE_STATUS.ARCHIVED && status !== TEMPLATE_STATUS.DEPRECATED;
    return {
      ...existing,
      ...overrides,
      templateId: ctx.templateId,
      templateVersionId: ctx.templateVersionId,
      version: ctx.versionNum,
      status,
      isActive,
      isLatestVersion: true,
      lastModifiedAt: ctx.nowIso,
      lastModifiedBy: overrides.lastModifiedBy ?? actorUserId ?? existing.lastModifiedBy,
      publishedAt:
        status === TEMPLATE_STATUS.PUBLISHED
          ? overrides.publishedAt ?? ctx.nowIso
          : overrides.publishedAt ?? existing.publishedAt ?? null,
    };
  }

  static buildCreateContext(input: CreateMasterTemplateInput): CreateMasterTemplateContext {
    const templateId = TemplateEntityBuilder.normalizeTemplateId(input.templateCode);
    const versionNum = input.version ?? 1;
    const templateVersionId = TemplateEntityBuilder.buildVersionId(templateId, versionNum);
    const versionSk = `${VERSION_SK_PREFIX}${String(versionNum).padStart(3, '0')}`;

    return {
      templateId,
      templateVersionId,
      versionNum,
      versionSk,
      nowIso: new Date().toISOString(),
      input,
    };
  }

  /**
   * DynamoDB `meta` — service keys for indexes and lifecycle.
   * `templateMetadata` / `templateProfile` / type sections stay on the VERSION row as sent in the payload.
   */
  static buildMeta(
    ctx: CreateMasterTemplateContext,
    body?: Record<string, unknown>,
  ): TemplateMeta {
    const { input, templateId, templateVersionId, versionNum, nowIso } = ctx;
    const rawBody = body ?? (input as Record<string, unknown>);
    const templateMetadata = asRecord(rawBody.templateMetadata);
    const templateProfile = asRecord(rawBody.templateProfile);

    const status = (input.status ?? TEMPLATE_STATUS.DRAFT) as TemplateStatus;
    const activeExplicit =
      typeof rawBody.active === 'boolean' ? rawBody.active : undefined;
    const category =
      input.category ?? templateProfile.category ?? input.conditions?.[0];
    const condition =
      input.condition ??
      templateProfile.condition ??
      (Array.isArray(input.conditions) ? input.conditions[0] : undefined);
    const specialty =
      input.specialty ?? input.specialties ?? asStringArray(templateProfile.specialty);
    const countries = input.countries ?? asStringArray(templateProfile.country);
    const languages = input.languages ?? asStringArray(templateProfile.language);
    const createdBy =
      input.createdBy ??
      firstString(templateMetadata.createdBy) ??
      firstString(templateMetadata.lastModifiedBy);
    const createdAt =
      firstString(templateMetadata.createdDate) ?? nowIso;
    const lastModifiedAt =
      firstString(templateMetadata.lastModifiedDate) ?? nowIso;

    return {
      templateId,
      templateVersionId,
      templateCode: input.templateCode,
      templateName: input.templateName ?? firstString(templateMetadata.templateName) ?? '',
      templateType: TemplateEntityBuilder.normalizeTemplateType(
        input.templateType ?? TEMPLATE_TYPE_CARE_PLAN,
      ),
      templateDescription: input.templateDescription as string | undefined,
      category,
      condition,
      conditions: input.conditions,
      countries,
      languages,
      specialty,
      version: versionNum,
      status,
      isActive:
        activeExplicit !== undefined
          ? activeExplicit
          : status !== TEMPLATE_STATUS.ARCHIVED && status !== TEMPLATE_STATUS.DEPRECATED,
      isLatestVersion: true,
      isMaster: true,
      shareScope:
        normalizeShareScope(rawBody.shareScope) ??
        normalizeShareScope(templateMetadata.shareScope) ??
        firstString(templateMetadata.shareScope),
      ownerOrgId: firstString(templateMetadata.ownerOrgId) ?? null,
      masterTemplateVersionId:
        typeof templateMetadata.masterTemplateVersionId === 'string'
          ? templateMetadata.masterTemplateVersionId
          : null,
      publishedAt: status === TEMPLATE_STATUS.PUBLISHED ? nowIso : null,
      createdAt,
      lastModifiedAt,
      createdBy,
      lastModifiedBy: createdBy,
    };
  }

  static applyGsiKeys(record: TemplateDdbRecord, meta: TemplateMeta): void {
    const templateType = meta.templateType ?? TEMPLATE_TYPE_CARE_PLAN;
    const status = meta.status ?? TEMPLATE_STATUS.DRAFT;
    const lastModifiedAt = meta.lastModifiedAt ?? new Date().toISOString();

    if (meta.templateCode) {
      record.gsi4pk = TemplateKeyBuilder.buildGsi4Pk(meta.templateCode);
      record.gsi4sk = TemplateKeyBuilder.buildGsi4Sk(meta.version ?? 1, meta.templateId);
    }

    record.gsi5pk = TemplateKeyBuilder.buildGsi5Pk(status);
    record.gsi5sk = TemplateKeyBuilder.buildGsi5Sk(lastModifiedAt, meta.templateId);

    if (status === TEMPLATE_STATUS.PUBLISHED && meta.publishedAt) {
      record.gsi2pk = TemplateKeyBuilder.buildGsi2Pk(templateType);
      record.gsi2sk = TemplateKeyBuilder.buildGsi2Sk(
        meta.publishedAt,
        meta.templateId,
        meta.templateVersionId,
      );
    } else {
      delete record.gsi2pk;
      delete record.gsi2sk;
    }
  }

  static buildMetaRow(ctx: CreateMasterTemplateContext): TemplateDdbRecord {
    const meta = TemplateEntityBuilder.buildMeta(ctx, ctx.input as Record<string, unknown>);
    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toMasterPk(ctx.templateId),
      sk: TEMPLATE_META_SK,
      entityType: ENTITY_TYPE_MASTER_TEMPLATE,
      meta,
    };
    TemplateEntityBuilder.applyGsiKeys(record, meta);
    return record;
  }

  static buildVersionRow(
    ctx: CreateMasterTemplateContext,
    body: Record<string, unknown>,
  ): TemplateDdbRecord {
    const meta = TemplateEntityBuilder.buildMeta(ctx, body);
    const documentFields = stripMetaBodyFields(body);

    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toMasterPk(ctx.templateId),
      sk: ctx.versionSk,
      entityType: ENTITY_TYPE_MASTER_TEMPLATE,
      meta,
      ...documentFields,
    };

    TemplateEntityBuilder.applyGsiKeys(record, meta);
    return record;
  }

  static buildMetaRowFromMeta(meta: TemplateMeta, templateId: string): TemplateDdbRecord {
    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toMasterPk(templateId),
      sk: TEMPLATE_META_SK,
      entityType: ENTITY_TYPE_MASTER_TEMPLATE,
      meta,
    };
    TemplateEntityBuilder.applyGsiKeys(record, meta);
    return record;
  }

  static buildVersionRowFromMeta(
    meta: TemplateMeta,
    ctx: MasterVersionWriteContext,
    documentFields: Record<string, unknown>,
  ): TemplateDdbRecord {
    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toMasterPk(ctx.templateId),
      sk: ctx.versionSk,
      entityType: ENTITY_TYPE_MASTER_TEMPLATE,
      meta,
      ...documentFields,
    };
    TemplateEntityBuilder.applyGsiKeys(record, meta);
    return record;
  }
}
