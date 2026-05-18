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
import { TemplateKeyBuilder } from './template-key.builder';

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

const META_BODY_KEYS = [
  'templateCode',
  'templateName',
  'templateType',
  'status',
  'version',
] as const;

function stripMetaBodyFields(body: Record<string, unknown>): Record<string, unknown> {
  const documentFields = { ...body };
  for (const key of META_BODY_KEYS) {
    delete documentFields[key];
  }
  return documentFields;
}

export class TemplateEntityBuilder {
  static normalizeTemplateId(templateCode: string): string {
    const base = templateCode.trim().replace(/_/g, '-').toUpperCase();
    return base || `TMPL-${randomUUID().slice(0, 8)}`;
  }

  static buildVersionId(templateId: string, versionNum: number): string {
    return `${templateId}-V${String(versionNum).padStart(2, '0')}`;
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

  static buildMeta(ctx: CreateMasterTemplateContext): TemplateMeta {
    const { input, templateId, templateVersionId, versionNum, nowIso } = ctx;
    const status = (input.status ?? TEMPLATE_STATUS.DRAFT) as TemplateStatus;
    const category = input.category ?? input.conditions?.[0];
    const condition =
      input.condition ??
      (Array.isArray(input.conditions) ? input.conditions[0] : undefined);
    const specialty = input.specialty ?? input.specialties;

    return {
      templateId,
      templateVersionId,
      templateCode: input.templateCode,
      templateName: input.templateName,
      templateType: input.templateType ?? TEMPLATE_TYPE_CARE_PLAN,
      templateDescription: input.templateDescription as string | undefined,
      category,
      condition,
      conditions: input.conditions,
      countries: input.countries,
      languages: input.languages,
      specialty,
      version: versionNum,
      status,
      isActive: status !== TEMPLATE_STATUS.ARCHIVED && status !== TEMPLATE_STATUS.DEPRECATED,
      isLatestVersion: true,
      publishedAt: status === TEMPLATE_STATUS.PUBLISHED ? nowIso : null,
      createdAt: nowIso,
      lastModifiedAt: nowIso,
      createdBy: input.createdBy,
      lastModifiedBy: input.createdBy,
    };
  }

  private static applyGsiKeys(record: TemplateDdbRecord, meta: TemplateMeta): void {
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
    }
  }

  static buildMetaRow(ctx: CreateMasterTemplateContext): TemplateDdbRecord {
    const meta = TemplateEntityBuilder.buildMeta(ctx);
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
    const meta = TemplateEntityBuilder.buildMeta(ctx);
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
}
