import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_ORG_ENABLEMENT,
  TEMPLATE_META_SK,
} from '../constants/template.constants';
import type { CreateOrgEnablementBody } from '../models/api/enablement.types';
import type { EnablementDdbRecord, EnablementMeta } from '../models/api/enablement.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
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
  ): EnablementMeta {
    const masterMeta = masterVersion.meta;
    return {
      enablementId,
      organizationId: body.organizationId,
      masterTemplateVersionId: body.masterTemplateVersionId,
      templateName: masterMeta.templateName,
      condition: firstString(masterMeta.condition ?? masterMeta.conditions),
      effectiveFrom: body.effectiveFrom?.trim() || nowIso,
      effectiveTo: body.effectiveTo ?? null,
      createdAt: nowIso,
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
