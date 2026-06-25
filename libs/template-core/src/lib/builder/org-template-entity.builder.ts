import { randomUUID } from 'crypto';

import {
  DERIVATION_KIND,
  ENTITY_TYPE_ORG_TEMPLATE,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  TEMPLATE_TYPE_CARE_PLAN,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { TemplateActorUser } from '../models/template-actor.model';
import type { TemplateDdbRecord, TemplateMeta } from '../models/persistence/template-ddb.model';
import { resolveTemplateActor } from '../utils/template-actor.utils';
import { extractCatalogCodes } from '../utils/field-values-profile.utils';
import { resolveOrgRulesFromMaster } from '../utils/template-rules.utils';
import { TemplateEntityBuilder, type MasterVersionWriteContext } from './template-entity.builder';
import { TemplateKeyBuilder } from './template-key.builder';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type CloneOrgTemplateContext = {
  organizationId: string;
  newTemplateId: string;
  templateVersionId: string;
  versionNum: number;
  versionSk: string;
  nowIso: string;
  sourceMasterTemplateId: string;
  sourceMasterVersionId: string;
  newTemplateName: string;
  inheritLinks: boolean;
};

export type OrgDeriveContext = {
  organizationId: string;
  newTemplateId: string;
  templateVersionId: string;
  versionNum: number;
  versionSk: string;
  nowIso: string;
  sourceOrgTemplateId: string;
  sourceOrgTemplateVersionId: string;
  newTemplateName: string;
};

const META_ROW_KEYS = new Set([
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

function extractDocumentFields(record: TemplateDdbRecord): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!META_ROW_KEYS.has(key)) {
      doc[key] = value;
    }
  }
  return doc;
}

export class OrgTemplateEntityBuilder {
  static slugifyTemplateName(name: string): string {
    const slug = name
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()
      .slice(0, 40);
    return slug || 'ORG-TMPL';
  }

  /** Variant id for POST /templates/org-derived. */
  static buildDerivedOrgTemplateId(newTemplateName: string): string {
    const slug = OrgTemplateEntityBuilder.slugifyTemplateName(newTemplateName);
    const suffix = randomUUID().slice(0, 8).toLowerCase();
    const base = `${slug}-${suffix}`;
    return base.length <= 120 ? base : `${slug.slice(0, 110)}-${suffix}`;
  }

  static buildOrgDeriveContext(
    organizationId: string,
    sourceOrgTemplateId: string,
    sourceOrgTemplateVersionId: string,
    newTemplateName: string,
  ): OrgDeriveContext {
    const newTemplateId = OrgTemplateEntityBuilder.buildDerivedOrgTemplateId(newTemplateName);
    const versionNum = 1;
    const templateVersionId = TemplateEntityBuilder.buildVersionId(newTemplateId, versionNum);
    const versionSk = `${VERSION_SK_PREFIX}${String(versionNum).padStart(3, '0')}`;

    return {
      organizationId,
      newTemplateId,
      templateVersionId,
      versionNum,
      versionSk,
      nowIso: new Date().toISOString(),
      sourceOrgTemplateId,
      sourceOrgTemplateVersionId,
      newTemplateName,
    };
  }

  static buildOrgTemplateId(masterTemplateId: string, organizationId: string): string {
    const orgSlug = organizationId
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .toUpperCase()
      .slice(0, 24);
    const base = `${masterTemplateId}-ORG-${orgSlug || 'ORG'}`;
    return base.length <= 120 ? base : `${base.slice(0, 110)}-${randomUUID().slice(0, 8)}`;
  }

  static buildCloneContext(
    organizationId: string,
    masterTemplateId: string,
    sourceMasterVersionId: string,
    newTemplateName: string,
    inheritLinks: boolean,
  ): CloneOrgTemplateContext {
    const newTemplateId = OrgTemplateEntityBuilder.buildOrgTemplateId(
      masterTemplateId,
      organizationId,
    );
    const versionNum = 1;
    const templateVersionId = TemplateEntityBuilder.buildVersionId(newTemplateId, versionNum);
    const versionSk = `${VERSION_SK_PREFIX}${String(versionNum).padStart(3, '0')}`;

    return {
      organizationId,
      newTemplateId,
      templateVersionId,
      versionNum,
      versionSk,
      nowIso: new Date().toISOString(),
      sourceMasterTemplateId: masterTemplateId,
      sourceMasterVersionId,
      newTemplateName,
      inheritLinks,
    };
  }

  static buildOrgMetaFromMaster(
    masterVersion: TemplateDdbRecord,
    ctx: CloneOrgTemplateContext,
    actor?: TemplateActorUser,
  ): TemplateMeta {
    const masterMeta = masterVersion.meta;
    const status = TEMPLATE_STATUS.DRAFT as TemplateStatus;
    const masterFv = asRecord(masterVersion.fieldValues);
    const catalog = extractCatalogCodes(masterFv);
    const countries = masterMeta.countries;
    const templateType = masterMeta.templateType ?? TEMPLATE_TYPE_CARE_PLAN;

    const masterDisplayVersion =
      typeof masterMeta.version === 'number' && masterMeta.version > 0
        ? masterMeta.version
        : ctx.versionNum;

    return {
      ...masterMeta,
      templateId: ctx.newTemplateId,
      templateVersionId: ctx.templateVersionId,
      templateName: ctx.newTemplateName,
      version: ctx.versionNum,
      derivedFromMasterVersion: masterDisplayVersion,
      status,
      isActive: false,
      isLatestVersion: true,
      isMaster: false,
      ownerOrgId: ctx.organizationId,
      masterTemplateId: ctx.sourceMasterTemplateId,
      masterTemplateVersionId: ctx.sourceMasterVersionId,
      derivedFromTemplateVersionId: ctx.sourceMasterVersionId,
      shareScope: 'ORG',
      publishedAt: null,
      createdAt: ctx.nowIso,
      lastModifiedAt: ctx.nowIso,
      createdBy: resolveTemplateActor(actor),
      lastModifiedBy: resolveTemplateActor(actor),
      templateType,
      ...(catalog.categoryCode ? { category: catalog.categoryCode } : {}),
      ...(catalog.conditionCode ? { condition: catalog.conditionCode } : {}),
      ...(countries ? { countries } : {}),
    };
  }

  static applyOrgGsiKeys(record: TemplateDdbRecord, meta: TemplateMeta, organizationId: string): void {
    const templateType = meta.templateType ?? TEMPLATE_TYPE_CARE_PLAN;
    const status = meta.status ?? TEMPLATE_STATUS.SAVED;
    const lastModifiedAt = meta.lastModifiedAt ?? new Date().toISOString();

    record.gsi1pk = TemplateKeyBuilder.buildGsi1OrgPk(organizationId);
    record.gsi1sk = TemplateKeyBuilder.buildGsi1OrgTemplateSk(
      templateType,
      status,
      lastModifiedAt,
      meta.templateId,
    );

    if (meta.templateCode) {
      record.gsi4pk = TemplateKeyBuilder.buildGsi4Pk(meta.templateCode);
      record.gsi4sk = TemplateKeyBuilder.buildGsi4Sk(meta.version ?? 1, meta.templateId);
    }

    delete record.gsi2pk;
    delete record.gsi2sk;
    delete record.gsi5pk;
    delete record.gsi5sk;
  }

  static buildOrgMetaRow(
    meta: TemplateMeta,
    organizationId: string,
    templateId: string,
  ): TemplateDdbRecord {
    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toOrgPk(organizationId, templateId),
      sk: TEMPLATE_META_SK,
      entityType: ENTITY_TYPE_ORG_TEMPLATE,
      meta,
    };
    OrgTemplateEntityBuilder.applyOrgGsiKeys(record, meta, organizationId);
    return record;
  }

  static buildOrgMetaFromOrgSource(
    sourceMetaRow: TemplateDdbRecord,
    ctx: OrgDeriveContext,
    actor?: TemplateActorUser,
    derivedFromOrgTemplateVersion?: number,
  ): TemplateMeta {
    const sourceMeta = sourceMetaRow.meta;
    const status = TEMPLATE_STATUS.DRAFT as TemplateStatus;
    const masterTemplateId =
      typeof sourceMeta.masterTemplateId === 'string' && sourceMeta.masterTemplateId.trim()
        ? sourceMeta.masterTemplateId.trim()
        : undefined;

    return {
      ...sourceMeta,
      templateId: ctx.newTemplateId,
      templateVersionId: ctx.templateVersionId,
      templateName: ctx.newTemplateName,
      version: ctx.versionNum,
      derivationKind: DERIVATION_KIND.ORG_DERIVE,
      derivedFromOrgTemplateId: ctx.sourceOrgTemplateId,
      derivedFromOrgTemplateVersionId: ctx.sourceOrgTemplateVersionId,
      ...(derivedFromOrgTemplateVersion !== undefined
        ? { derivedFromOrgTemplateVersion }
        : {}),
      derivedAt: ctx.nowIso,
      status,
      isActive: true,
      isLatestVersion: true,
      isMaster: false,
      ownerOrgId: ctx.organizationId,
      masterTemplateId,
      shareScope: 'ORG',
      publishedAt: null,
      createdAt: ctx.nowIso,
      lastModifiedAt: ctx.nowIso,
      createdBy: resolveTemplateActor(actor),
      lastModifiedBy: resolveTemplateActor(actor),
    };
  }

  static buildOrgVersionRowFromOrgSource(
    meta: TemplateMeta,
    ctx: OrgDeriveContext,
    sourceVersion: TemplateDdbRecord,
  ): TemplateDdbRecord {
    const documentFields = extractDocumentFields(sourceVersion);
    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toOrgPk(ctx.organizationId, ctx.newTemplateId),
      sk: ctx.versionSk,
      entityType: ENTITY_TYPE_ORG_TEMPLATE,
      meta,
      ...documentFields,
    };
    OrgTemplateEntityBuilder.applyOrgGsiKeys(record, meta, ctx.organizationId);
    return record;
  }

  static buildOrgVersionRow(
    meta: TemplateMeta,
    ctx: CloneOrgTemplateContext,
    masterVersion: TemplateDdbRecord,
  ): TemplateDdbRecord {
    const documentFields = extractDocumentFields(masterVersion);
    if (!ctx.inheritLinks && documentFields.links) {
      delete documentFields.links;
    }
    documentFields.rules = resolveOrgRulesFromMaster(masterVersion);

    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toOrgPk(ctx.organizationId, ctx.newTemplateId),
      sk: ctx.versionSk,
      entityType: ENTITY_TYPE_ORG_TEMPLATE,
      meta,
      ...documentFields,
    };
    OrgTemplateEntityBuilder.applyOrgGsiKeys(record, meta, ctx.organizationId);
    return record;
  }

  static buildOrgVersionRowFromMeta(
    meta: TemplateMeta,
    organizationId: string,
    templateId: string,
    ctx: MasterVersionWriteContext,
    documentFields: Record<string, unknown>,
  ): TemplateDdbRecord {
    const record: TemplateDdbRecord = {
      pk: TemplateKeyBuilder.toOrgPk(organizationId, templateId),
      sk: ctx.versionSk,
      entityType: ENTITY_TYPE_ORG_TEMPLATE,
      meta,
      ...documentFields,
    };
    OrgTemplateEntityBuilder.applyOrgGsiKeys(record, meta, organizationId);
    return record;
  }
}
