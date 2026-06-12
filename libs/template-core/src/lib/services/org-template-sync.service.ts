import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import {
  OrgTemplateEntityBuilder,
  type CloneOrgTemplateContext,
} from '../builder/org-template-entity.builder';
import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { TEMPLATE_STATUS, VERSION_SK_PREFIX } from '../constants/template.constants';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type { TemplateActorUser } from '../models/template-actor.model';
import type { TemplateDdbRecord, TemplateMeta } from '../models/persistence/template-ddb.model';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { isActiveEnablement, resolveEnablementMasterTemplateId } from '../utils/enablement.utils';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  firstString,
  resolveOrgVersionPointerSk,
  templateNotFoundError,
} from '../utils/template.utils';

function resolveOrgTemplateVersionId(meta: TemplateMeta, orgTemplateId: string): string {
  const id = meta.templateVersionId?.trim();
  if (id && id.includes('-ORG-') && /-V\d+$/i.test(id)) {
    return id;
  }
  return TemplateEntityBuilder.buildVersionId(orgTemplateId, 1);
}

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
    options?: { adoptMasterVersion?: boolean },
  ): Promise<EnablementDdbRecord> {
    const masterTemplateId = masterVersion.meta.templateId;
    const adoptMasterVersion = options?.adoptMasterVersion !== false;
    const masterTemplateVersionId = masterVersion.meta.templateVersionId;
    const nowIso = new Date().toISOString();

    const existing = await this.enablementRepo.findByOrgAndMasterTemplateId(
      organizationId,
      masterTemplateId,
    );

    if (existing) {
      const masterTemplateVersion = adoptMasterVersion
        ? typeof masterVersion.meta.version === 'number' && masterVersion.meta.version > 0
          ? masterVersion.meta.version
          : existing.meta.masterTemplateVersion
        : existing.meta.masterTemplateVersion;

      const resolvedMasterTemplateVersionId = adoptMasterVersion
        ? masterTemplateVersionId
        : existing.meta.masterTemplateVersionId;

      const meta = {
        ...existing.meta,
        masterTemplateId,
        masterTemplateVersionId: resolvedMasterTemplateVersionId,
        masterTemplateVersion,
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
    options?: { adoptMasterVersion?: boolean },
  ): Promise<TemplateDdbRecord> {
    const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
    if (!metaRow) {
      templateNotFoundError(`Org template ${orgTemplateId} not found`);
    }

    const versionRow = await this.orgRepo.getOrgVersionForMeta(
      organizationId,
      orgTemplateId,
      metaRow.meta,
    );
    const versionSk =
      versionRow?.sk ?? resolveOrgVersionPointerSk(metaRow.meta) ?? `${VERSION_SK_PREFIX}001`;

    const ctx: CloneOrgTemplateContext = {
      organizationId,
      newTemplateId: orgTemplateId,
      templateVersionId: resolveOrgTemplateVersionId(metaRow.meta, orgTemplateId),
      versionNum: metaRow.meta.version ?? 1,
      versionSk,
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
    const adoptMasterVersion = options?.adoptMasterVersion !== false;
    const syncedMasterVersion =
      typeof masterVersion.meta.version === 'number' && masterVersion.meta.version > 0
        ? masterVersion.meta.version
        : mergedMeta.derivedFromMasterVersion;
    const adoptedMasterVersion = adoptMasterVersion
      ? syncedMasterVersion
      : typeof metaRow.meta.derivedFromMasterVersion === 'number' &&
          metaRow.meta.derivedFromMasterVersion > 0
        ? metaRow.meta.derivedFromMasterVersion
        : syncedMasterVersion;
    const adoptedMasterTemplateVersionId = adoptMasterVersion
      ? masterVersion.meta.templateVersionId
      : metaRow.meta.derivedFromTemplateVersionId?.trim() ||
        metaRow.meta.masterTemplateVersionId?.trim() ||
        masterVersion.meta.templateVersionId;

    const preserved: TemplateMeta = {
      ...mergedMeta,
      templateId: metaRow.meta.templateId,
      templateVersionId: resolveOrgTemplateVersionId(metaRow.meta, orgTemplateId),
      version: metaRow.meta.version,
      derivedFromMasterVersion: adoptedMasterVersion,
      derivedFromTemplateVersionId: adoptedMasterTemplateVersionId,
      masterTemplateVersionId: adoptedMasterTemplateVersionId,
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

        // Passive master publish/update: refresh enablement display fields only.
        // Org templates stay on their adopted master version until explicit derive/adopt.
        await this.upsertEnablementForOrg(orgId, masterVersion, orgTemplateId, {
          adoptMasterVersion: false,
        });
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
