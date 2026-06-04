import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import {
  OrgTemplateEntityBuilder,
  type CloneOrgTemplateContext,
} from '../builder/org-template-entity.builder';
import { TEMPLATE_STATUS, VERSION_SK_PREFIX } from '../constants/template.constants';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type { TemplateActorUser } from '../models/template-actor.model';
import type { TemplateDdbRecord, TemplateMeta } from '../models/persistence/template-ddb.model';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { isActiveEnablement, resolveEnablementMasterTemplateId } from '../utils/enablement.utils';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { firstString, templateVersionIdToSk } from '../utils/template.utils';

export class OrgTemplateSyncService {
  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly enablementRepo = new EnablementRepository(),
    private readonly masterRepo = new TemplateRepository(),
  ) {}

  async upsertEnablementForOrg(
    organizationId: string,
    masterVersion: TemplateDdbRecord,
    orgTemplateId: string,
  ): Promise<EnablementDdbRecord> {
    const masterTemplateId = masterVersion.meta.templateId;
    const masterTemplateVersionId = masterVersion.meta.templateVersionId;
    const nowIso = new Date().toISOString();

    const existing = await this.enablementRepo.findByOrgAndMasterTemplateId(
      organizationId,
      masterTemplateId,
    );

    if (existing) {
      const meta = {
        ...existing.meta,
        masterTemplateId,
        masterTemplateVersionId,
        orgTemplateId,
        templateName: masterVersion.meta.templateName,
        templateType: masterVersion.meta.templateType,
        updatedAt: nowIso,
        effectiveTo: null,
      };
      const masterFv =
        masterVersion.fieldValues &&
        typeof masterVersion.fieldValues === 'object' &&
        !Array.isArray(masterVersion.fieldValues)
          ? (masterVersion.fieldValues as Record<string, unknown>)
          : {};
      meta.categoryCode =
        firstString(masterFv.categoryCode) ?? firstString(masterVersion.meta.category);
      meta.conditionCode =
        firstString(masterFv.conditionCode) ?? firstString(masterVersion.meta.condition);
      const row = EnablementEntityBuilder.buildRow(meta);
      await this.enablementRepo.putEnablementOverwrite(row);
      return row;
    }

    const enablementId = EnablementEntityBuilder.buildEnablementId(organizationId);
    const meta = EnablementEntityBuilder.buildMeta(
      {
        organizationId,
        masterTemplateVersionId,
        effectiveFrom: nowIso,
        effectiveTo: null,
      },
      masterVersion,
      enablementId,
      nowIso,
      { orgTemplateId },
    );
    const row = EnablementEntityBuilder.buildRow(meta);
    await this.enablementRepo.putEnablement(row);
    return row;
  }

  async syncOrgTemplateContentFromMaster(
    organizationId: string,
    orgTemplateId: string,
    masterTemplateId: string,
    masterVersion: TemplateDdbRecord,
    actor?: TemplateActorUser,
  ): Promise<TemplateDdbRecord> {
    const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
    if (!metaRow) {
      throw new Error(`Org template ${orgTemplateId} not found`);
    }

    const versionSk =
      templateVersionIdToSk(metaRow.meta.templateVersionId) ??
      `${VERSION_SK_PREFIX}${String(metaRow.meta.version ?? 1).padStart(3, '0')}`;
    const versionRow = await this.orgRepo.getOrgVersion(organizationId, orgTemplateId, versionSk);
    if (!versionRow) {
      throw new Error(`Org template version ${orgTemplateId} not found`);
    }

    const ctx: CloneOrgTemplateContext = {
      organizationId,
      newTemplateId: orgTemplateId,
      templateVersionId: metaRow.meta.templateVersionId,
      versionNum: metaRow.meta.version ?? 1,
      versionSk: versionRow.sk,
      nowIso: new Date().toISOString(),
      sourceMasterTemplateId: masterTemplateId,
      sourceMasterVersionId: masterVersion.meta.templateVersionId,
      newTemplateName: masterVersion.meta.templateName?.trim() || metaRow.meta.templateName || orgTemplateId,
      inheritLinks: true,
    };

    const mergedMeta = OrgTemplateEntityBuilder.buildOrgMetaFromMaster(
      masterVersion,
      ctx,
      actor,
    );
    const preserved: TemplateMeta = {
      ...mergedMeta,
      templateId: metaRow.meta.templateId,
      templateVersionId: metaRow.meta.templateVersionId,
      version: metaRow.meta.version,
      createdAt: metaRow.meta.createdAt,
      createdBy: metaRow.meta.createdBy,
      status: metaRow.meta.status ?? mergedMeta.status,
      masterTemplateId,
    };

    const newMetaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
      preserved,
      organizationId,
      orgTemplateId,
    );
    const newVersionRow = OrgTemplateEntityBuilder.buildOrgVersionRow(preserved, ctx, masterVersion);
    await this.orgRepo.saveOrgMetaAndVersion(newMetaRow, newVersionRow);
    return newVersionRow;
  }

  async syncAllEnabledOrgsFromMaster(
    masterVersion: TemplateDdbRecord,
    actor?: TemplateActorUser,
  ): Promise<void> {
    try {
      if (masterVersion.meta?.status !== TEMPLATE_STATUS.PUBLISHED) {
        return;
      }

      const masterTemplateId = masterVersion.meta.templateId;
      const enablements = await this.listEnablementsForMasterTemplate(masterTemplateId);

      for (const en of enablements) {
        if (!isActiveEnablement(en)) continue;
        const orgId = en.meta.organizationId;
        const orgTemplateId =
          en.meta.orgTemplateId?.trim() ||
          OrgTemplateEntityBuilder.buildOrgTemplateId(masterTemplateId, orgId);

        const orgMeta = await this.orgRepo.getOrgMeta(orgId, orgTemplateId);
        if (orgMeta) {
          await this.syncOrgTemplateContentFromMaster(
            orgId,
            orgTemplateId,
            masterTemplateId,
            masterVersion,
            actor,
          );
        }

        await this.upsertEnablementForOrg(orgId, masterVersion, orgTemplateId);
      }
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async listEnablementsForMasterTemplate(
    masterTemplateId: string,
  ): Promise<EnablementDdbRecord[]> {
    const seen = new Set<string>();
    const out: EnablementDdbRecord[] = [];

    const byMaster = await this.enablementRepo.queryEnablementsByMasterTemplateGsi5(
      masterTemplateId,
      200,
    );
    for (const row of byMaster) {
      if (seen.has(row.meta.enablementId)) continue;
      seen.add(row.meta.enablementId);
      out.push(row);
    }

    const { items } = await this.masterRepo.queryMasterVersionsPage(masterTemplateId, {
      limit: 50,
    });
    const published = items.filter((r) => r.meta?.status === TEMPLATE_STATUS.PUBLISHED);
    for (const versionRow of published) {
      const versionId = versionRow.meta.templateVersionId;
      const legacy = await this.enablementRepo.queryEnablementsByMasterVersionGsi3(versionId, 100);
      for (const row of legacy) {
        if (resolveEnablementMasterTemplateId(row.meta) !== masterTemplateId) continue;
        if (seen.has(row.meta.enablementId)) continue;
        seen.add(row.meta.enablementId);
        out.push(row);
      }
    }

    return out;
  }
}
