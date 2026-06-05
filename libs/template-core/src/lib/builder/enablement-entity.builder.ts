import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_ORG_ENABLEMENT,
  TEMPLATE_META_SK,
} from '../constants/template.constants';
import type { CreateOrgEnablementBody } from '../models/api/enablement.types';
import type { EnablementDdbRecord, EnablementMeta } from '../models/api/enablement.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { OrgTemplateEntityBuilder } from './org-template-entity.builder';
import { TemplateKeyBuilder } from './template-key.builder';
import { firstString } from '../utils/template.utils';

export class EnablementEntityBuilder {
  static buildEnablementId(organizationId: string): string {
    const slug = organizationId
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 12)
      .toUpperCase();
    return `ENB-${slug || 'ORG'}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  static buildMeta(
    body: CreateOrgEnablementBody,
    masterVersion: TemplateDdbRecord,
    enablementId: string,
    nowIso: string,
    opts?: { orgTemplateId?: string },
  ): EnablementMeta {
    const masterMeta = masterVersion.meta;
    const masterFv =
      masterVersion.fieldValues &&
      typeof masterVersion.fieldValues === 'object' &&
      !Array.isArray(masterVersion.fieldValues)
        ? (masterVersion.fieldValues as Record<string, unknown>)
        : {};
    const masterTemplateId = masterMeta.templateId;
    const orgTemplateId =
      opts?.orgTemplateId?.trim() ||
      OrgTemplateEntityBuilder.buildOrgTemplateId(masterTemplateId, body.organizationId);

    const masterTemplateVersion =
      typeof masterMeta.version === 'number' && masterMeta.version > 0
        ? masterMeta.version
        : 1;

    return {
      enablementId,
      organizationId: body.organizationId,
      masterTemplateId,
      masterTemplateVersionId: body.masterTemplateVersionId,
      masterTemplateVersion,
      orgTemplateId,
      templateName: masterMeta.templateName,
      templateType: masterMeta.templateType,
      categoryCode: firstString(masterFv.categoryCode) ?? firstString(masterMeta.category),
      conditionCode: firstString(masterFv.conditionCode) ?? firstString(masterMeta.condition),
      condition: firstString(masterMeta.condition ?? masterMeta.conditions),
      effectiveFrom: body.effectiveFrom?.trim() || nowIso,
      effectiveTo: body.effectiveTo ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  static buildRow(meta: EnablementMeta): EnablementDdbRecord {
    const record: EnablementDdbRecord = {
      pk: TemplateKeyBuilder.toEnablePk(meta.enablementId),
      sk: TEMPLATE_META_SK,
      entityType: ENTITY_TYPE_ORG_ENABLEMENT,
      meta,
      gsi1pk: TemplateKeyBuilder.buildGsi1OrgPk(meta.organizationId),
      gsi1sk: TemplateKeyBuilder.buildGsi1EnableSk(meta.effectiveFrom, meta.enablementId),
      gsi3pk: TemplateKeyBuilder.buildGsi3Pk(meta.masterTemplateVersionId),
      gsi3sk: TemplateKeyBuilder.buildGsi3Sk(meta.organizationId, meta.enablementId),
      gsi5pk: TemplateKeyBuilder.buildGsi5EnableMasterPk(meta.masterTemplateId),
      gsi5sk: TemplateKeyBuilder.buildGsi5EnableSk(meta.organizationId, meta.enablementId),
    };
    return record;
  }

  static applyDateUpdates(
    record: EnablementDdbRecord,
    updates: { effectiveFrom?: string | null; effectiveTo?: string | null },
  ): EnablementDdbRecord {
    const meta: EnablementMeta = { ...record.meta };
    if (updates.effectiveFrom !== undefined && updates.effectiveFrom !== null) {
      meta.effectiveFrom = updates.effectiveFrom.trim();
    }
    if (updates.effectiveTo !== undefined) {
      meta.effectiveTo = updates.effectiveTo;
    }
    return EnablementEntityBuilder.buildRow(meta);
  }
}
