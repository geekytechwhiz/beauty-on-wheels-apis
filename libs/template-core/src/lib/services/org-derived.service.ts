import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  DERIVATION_KIND,
  ORG_EDITABLE_STATUSES,
  TEMPLATE_META_SK,
  type TemplateStatus,
} from '../constants/template.constants';
import {
  buildOrgDerivedFilterOptions,
  toOrgDerivedCreateResult,
  toOrgDerivedDetail,
  toOrgDerivedListItem,
  toUpdateOrgDerivedResult,
} from '../mappers/org-derived.dto';
import type {
  OrgDerivedCreateParams,
  OrgDerivedCreateResult,
  GetOrgDerivedResult,
  ListOrgDerivedParams,
  ListOrgDerivedResult,
  UpdateOrgDerivedParams,
  UpdateOrgDerivedResult,
} from '../models/api/org-derived.types';
import type { OrganizationMeta } from '../models/api/list-org-catalog.types';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { OrgProfileMeta } from '../models/persistence/org-profile.model';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgProfileRepository } from '../repositories/org-profile.repository';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { isActiveEnablement } from '../utils/enablement.utils';
import { extractCatalogCodes } from '../utils/field-values-profile.utils';
import {
  asTemplateRulesMap,
  buildRulesFromFieldValues,
  mergeOrgRulesPartial,
  mergeRulesAfterFieldValuesChange,
  OrgRulesValidationError,
} from '../utils/template-rules.utils';
import {
  decodeListCursor,
  encodeListCursor,
  normalizeVersionToSk,
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
} from '../utils/template.utils';
import { OrgTemplateOpsService } from './org-template-ops.service';

function eqCi(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function decodeOffsetToken(token: string | undefined): number {
  const decoded = decodeListCursor(token);
  const offset = decoded?.o;
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasFieldValuesPatch(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function assertEditableStatus(status: TemplateStatus | undefined, action: string): void {
  if (!status || !ORG_EDITABLE_STATUSES.includes(status)) {
    templateConflictError(
      `Cannot ${action} org template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
}

function isOrgDerivedVariant(meta: TemplateDdbRecord['meta']): boolean {
  return meta.derivationKind === DERIVATION_KIND.ORG_DERIVE;
}

type OrgDerivedRow = {
  metaRow: TemplateDdbRecord;
  versionRow: TemplateDdbRecord;
  enablement: EnablementDdbRecord | null;
};

export class OrgDerivedService {
  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly enablementRepo = new EnablementRepository(),
    private readonly orgProfileRepo = new OrgProfileRepository(),
    private readonly orgOps = new OrgTemplateOpsService(),
  ) {}

  async createOrgDerived(params: OrgDerivedCreateParams): Promise<OrgDerivedCreateResult> {
    try {
      const organizationId = params.organizationId.trim();
      const sourceOrgTemplateId = params.sourceOrgTemplateId.trim();
      const newTemplateName = params.newTemplateName.trim();
      const templateEnabled = params.templateEnabled !== false;
      const nowIso = new Date().toISOString();

      if (params.organizationMeta) {
        await this.upsertOrganizationProfile(params.organizationMeta);
      }

      const sourceMetaRow = await this.orgRepo.getOrgMeta(organizationId, sourceOrgTemplateId);
      if (!sourceMetaRow) {
        templateNotFoundError('Source org template not found');
      }

      if (isOrgDerivedVariant(sourceMetaRow.meta)) {
        templateConflictError(
          'sourceOrgTemplateId must be the canonical org template from derive, not an org-derived variant',
        );
      }

      let sourceVersionRow: TemplateDdbRecord | null = null;
      if (params.sourceVersionId?.trim()) {
        const versionSk = normalizeVersionToSk(params.sourceVersionId.trim());
        sourceVersionRow = await this.orgRepo.getOrgVersion(
          organizationId,
          sourceOrgTemplateId,
          versionSk,
        );
        if (!sourceVersionRow) {
          templateNotFoundError('Source org template version not found');
        }
      } else {
        sourceVersionRow = await this.orgRepo.getOrgVersionForMeta(
          organizationId,
          sourceOrgTemplateId,
          sourceMetaRow.meta,
        );
        if (!sourceVersionRow) {
          templateNotFoundError('Source org template version not found');
        }
      }

      await this.assertUniqueVariantName(organizationId, newTemplateName);

      const sourceOrgTemplateVersionId =
        sourceVersionRow.meta.templateVersionId ??
        sourceMetaRow.meta.templateVersionId ??
        params.sourceVersionId?.trim() ??
        '';

      const ctx = OrgTemplateEntityBuilder.buildOrgDeriveContext(
        organizationId,
        sourceOrgTemplateId,
        sourceOrgTemplateVersionId,
        newTemplateName,
      );

      const meta = OrgTemplateEntityBuilder.buildOrgMetaFromOrgSource(
        sourceMetaRow,
        ctx,
        params.actorUser,
      );
      const metaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(meta, organizationId, ctx.newTemplateId);
      const versionRow = OrgTemplateEntityBuilder.buildOrgVersionRowFromOrgSource(
        meta,
        ctx,
        sourceVersionRow,
      );

      await this.orgRepo.createOrgTemplate(metaRow, versionRow);

      const masterTemplateId =
        typeof sourceMetaRow.meta.masterTemplateId === 'string'
          ? sourceMetaRow.meta.masterTemplateId.trim()
          : '';
      if (!masterTemplateId) {
        templateValidationError('Source org template is missing masterTemplateId');
      }

      const fv = asRecord(sourceVersionRow.fieldValues);
      const catalog = extractCatalogCodes(fv);
      const masterTemplateVersionId =
        typeof sourceMetaRow.meta.masterTemplateVersionId === 'string'
          ? sourceMetaRow.meta.masterTemplateVersionId
          : sourceOrgTemplateVersionId;

      const enablementId = EnablementEntityBuilder.buildEnablementId(organizationId);
      const enablementMeta = EnablementEntityBuilder.buildMetaForOrgDerived(
        {
          organizationId,
          orgTemplateId: ctx.newTemplateId,
          masterTemplateId,
          masterTemplateVersionId,
          masterTemplateVersion:
            typeof sourceMetaRow.meta.derivedFromMasterVersion === 'number'
              ? sourceMetaRow.meta.derivedFromMasterVersion
              : undefined,
          templateName: newTemplateName,
          templateType: meta.templateType,
          categoryCode: catalog.categoryCode,
          conditionCode: catalog.conditionCode,
          effectiveFrom: nowIso,
          effectiveTo: templateEnabled ? null : nowIso,
        },
        enablementId,
        nowIso,
      );
      await this.enablementRepo.putEnablement(EnablementEntityBuilder.buildRow(enablementMeta));

      return toOrgDerivedCreateResult(
        organizationId,
        sourceOrgTemplateId,
        metaRow,
        versionRow,
        templateEnabled,
      );
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  async getOrgDerived(params: ListOrgDerivedParams): Promise<GetOrgDerivedResult | ListOrgDerivedResult> {
    try {
      const organizationId = params.organizationId.trim();
      if (params.orgTemplateId?.trim()) {
        return await this.getOrgDerivedSingle(organizationId, params.orgTemplateId.trim());
      }
      return await this.listOrgDerived(params);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async updateOrgDerived(params: UpdateOrgDerivedParams): Promise<UpdateOrgDerivedResult> {
    try {
      const organizationId = params.organizationId.trim();
      const orgTemplateId = params.orgTemplateId.trim();
      const ruleKeys = Object.keys(params.rules ?? {});
      const hasFieldValues = hasFieldValuesPatch(params.fieldValues);
      const hasEnablePatch = params.templateEnabled !== undefined;

      if (ruleKeys.length === 0 && !hasFieldValues && !hasEnablePatch) {
        templateValidationError('rules, fieldValues, or templateEnabled must be provided');
      }

      const resolved = await this.resolveOrgDerivedVariant(organizationId, orgTemplateId);
      let versionRow = resolved.versionRow;
      let templateEnabled = resolved.enablement
        ? isActiveEnablement(resolved.enablement)
        : false;

      if (hasEnablePatch && params.templateEnabled !== undefined) {
        templateEnabled = await this.applyVariantEnablement(
          resolved.enablement,
          organizationId,
          orgTemplateId,
          resolved.metaRow,
          versionRow,
          params.templateEnabled,
        );
      }

      if (ruleKeys.length > 0 || hasFieldValues) {
        const currentStatus = versionRow.meta?.status ?? resolved.metaRow.meta.status;
        assertEditableStatus(currentStatus, 'update org-derived template');

        const mergedDocument = {
          ...this.orgOps.extractDocumentFields(versionRow),
        };

        if (hasFieldValues) {
          mergedDocument.fieldValues = {
            ...asRecord(versionRow.fieldValues),
            ...params.fieldValues,
          };
        }

        const templateType = versionRow.meta?.templateType ?? resolved.metaRow.meta.templateType;

        let nextRules = asTemplateRulesMap(versionRow.rules);
        if (hasFieldValues) {
          nextRules = mergeRulesAfterFieldValuesChange(
            asRecord(versionRow.rules),
            buildRulesFromFieldValues(asRecord(mergedDocument.fieldValues), { templateType }),
            {
              templateType,
              fieldValues: asRecord(mergedDocument.fieldValues),
              previousFieldValues: asRecord(versionRow.fieldValues),
            },
          );
        }

        if (ruleKeys.length > 0) {
          nextRules = mergeOrgRulesPartial(nextRules, params.rules!);
        }

        mergedDocument.rules = nextRules;

        versionRow = await this.orgOps.saveOrgTemplateInPlace({
          organizationId,
          templateId: orgTemplateId,
          metaRow: resolved.metaRow,
          sourceVersion: versionRow,
          mergedDocument,
          actorUser: params.actorUser,
          bumpVersion: true,
        });
      }

      return toUpdateOrgDerivedResult(resolved.metaRow, versionRow, templateEnabled);
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  private async getOrgDerivedSingle(
    organizationId: string,
    orgTemplateId: string,
  ): Promise<GetOrgDerivedResult> {
    const resolved = await this.resolveOrgDerivedVariant(organizationId, orgTemplateId);
    return toOrgDerivedDetail(
      organizationId,
      resolved.metaRow,
      resolved.versionRow,
      resolved.enablement,
    );
  }

  private async listOrgDerived(params: ListOrgDerivedParams): Promise<ListOrgDerivedResult> {
    const organizationId = params.organizationId.trim();
    const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
    const offset = decodeOffsetToken(params.nextToken);

    const organizationMeta = await this.resolveStoredOrganizationMeta(organizationId);
    const allRows = await this.loadOrgDerivedRows(organizationId);
    const filterOptions = buildOrgDerivedFilterOptions(allRows);

    const filtered = await this.filterOrgDerivedRows(allRows, params);
    const pageItems = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;
    const nextToken = hasMore ? encodeListCursor({ o: offset + limit }) : undefined;

    const items = pageItems.map((row) =>
      toOrgDerivedListItem(
        row.metaRow,
        row.versionRow,
        row.enablement,
      ),
    );

    return {
      organizationMeta,
      items,
      filterOptions,
      pagination: {
        limit,
        count: items.length,
        total: filtered.length,
        hasMore,
        nextToken,
      },
    };
  }

  private async loadOrgDerivedRows(organizationId: string): Promise<OrgDerivedRow[]> {
    const rows: OrgDerivedRow[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const page = await this.orgRepo.queryOrgTemplatesGsi1Page(
        { organizationId },
        { limit: 100, exclusiveStartKey },
      );

      for (const item of page.items) {
        if (item.sk !== TEMPLATE_META_SK) continue;
        if (!isOrgDerivedVariant(item.meta)) continue;

        const versionRow = await this.orgRepo.getOrgVersionForMeta(
          organizationId,
          item.meta.templateId,
          item.meta,
        );
        if (!versionRow) continue;

        const enablement = await this.enablementRepo.findByOrgAndOrgTemplateId(
          organizationId,
          item.meta.templateId,
        );

        rows.push({ metaRow: item, versionRow, enablement });
      }

      exclusiveStartKey = page.lastEvaluatedKey;
    } while (exclusiveStartKey);

    return rows;
  }

  private async filterOrgDerivedRows(
    rows: OrgDerivedRow[],
    params: ListOrgDerivedParams,
  ): Promise<OrgDerivedRow[]> {
    const conditionFilter = params.conditionCode ?? params.condition;
    const nameFilter = params.templateName?.trim().toLowerCase();

    const filtered: OrgDerivedRow[] = [];
    for (const row of rows) {
      const fv = asRecord(row.versionRow.fieldValues);
      const catalog = extractCatalogCodes(fv);

      if (params.categoryCode && !eqCi(catalog.categoryCode, params.categoryCode)) continue;
      if (conditionFilter && !eqCi(catalog.conditionCode, conditionFilter)) continue;
      if (params.templateType && !eqCi(row.metaRow.meta.templateType, params.templateType)) continue;

      if (params.specialty?.trim()) {
        const specs = Array.isArray(row.metaRow.meta.specialty)
          ? row.metaRow.meta.specialty.map(String)
          : catalog.specialty
            ? [catalog.specialty]
            : [];
        if (!specs.some((s) => eqCi(s, params.specialty))) continue;
      }

      if (nameFilter) {
        const name = row.metaRow.meta.templateName?.trim().toLowerCase() ?? '';
        if (!name.includes(nameFilter)) continue;
      }

      if (params.templateEnabled !== undefined) {
        const enabled = row.enablement ? isActiveEnablement(row.enablement) : false;
        if (enabled !== params.templateEnabled) continue;
      }

      filtered.push(row);
    }

    return filtered;
  }

  private async resolveOrgDerivedVariant(
    organizationId: string,
    orgTemplateId: string,
  ): Promise<OrgDerivedRow> {
    const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
    if (!metaRow || !isOrgDerivedVariant(metaRow.meta)) {
      templateNotFoundError('Org-derived template not found');
    }

    const versionRow = await this.orgRepo.getOrgVersionForMeta(
      organizationId,
      orgTemplateId,
      metaRow.meta,
    );
    if (!versionRow) {
      templateNotFoundError('Org-derived template version not found');
    }

    const enablement = await this.enablementRepo.findByOrgAndOrgTemplateId(
      organizationId,
      orgTemplateId,
    );

    return { metaRow, versionRow, enablement };
  }

  private async assertUniqueVariantName(
    organizationId: string,
    newTemplateName: string,
  ): Promise<void> {
    const rows = await this.loadOrgDerivedRows(organizationId);
    const normalized = newTemplateName.trim().toLowerCase();
    const duplicate = rows.some(
      (row) => row.metaRow.meta.templateName?.trim().toLowerCase() === normalized,
    );
    if (duplicate) {
      templateConflictError(
        `An org-derived template named "${newTemplateName}" already exists for this organization`,
      );
    }
  }

  private async applyVariantEnablement(
    existing: EnablementDdbRecord | null,
    organizationId: string,
    orgTemplateId: string,
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    wantEnabled: boolean,
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();

    if (!existing) {
      const masterTemplateId =
        typeof metaRow.meta.masterTemplateId === 'string'
          ? metaRow.meta.masterTemplateId.trim()
          : '';
      if (!masterTemplateId) {
        templateValidationError('Org-derived template is missing masterTemplateId');
      }

      const fv = asRecord(versionRow.fieldValues);
      const catalog = extractCatalogCodes(fv);
      const enablementId = EnablementEntityBuilder.buildEnablementId(organizationId);
      const enablementMeta = EnablementEntityBuilder.buildMetaForOrgDerived(
        {
          organizationId,
          orgTemplateId,
          masterTemplateId,
          masterTemplateVersionId:
            metaRow.meta.templateVersionId ?? versionRow.meta.templateVersionId ?? '',
          templateName: metaRow.meta.templateName ?? orgTemplateId,
          templateType: metaRow.meta.templateType,
          categoryCode: catalog.categoryCode,
          conditionCode: catalog.conditionCode,
          effectiveFrom: nowIso,
          effectiveTo: wantEnabled ? null : nowIso,
        },
        enablementId,
        nowIso,
      );
      await this.enablementRepo.putEnablement(EnablementEntityBuilder.buildRow(enablementMeta));
      return wantEnabled;
    }

    if (wantEnabled && isActiveEnablement(existing)) {
      return true;
    }
    if (!wantEnabled && !isActiveEnablement(existing)) {
      return false;
    }

    const updated = EnablementEntityBuilder.applyDateUpdates(existing, {
      effectiveTo: wantEnabled ? null : nowIso,
      ...(wantEnabled ? { effectiveFrom: nowIso } : {}),
    });
    updated.meta.updatedAt = nowIso;
    await this.enablementRepo.putEnablementOverwrite(updated);
    return wantEnabled;
  }

  private async resolveStoredOrganizationMeta(organizationId: string): Promise<OrganizationMeta> {
    const profile = await this.orgProfileRepo.getOrgProfile(organizationId);
    const stored = profile?.meta;
    return {
      id: organizationId,
      name: stored?.name?.trim() || organizationId,
      active: stored?.active,
      country: stored?.country,
      updated: stored?.updated,
      description: stored?.description ?? null,
    };
  }

  private async upsertOrganizationProfile(input: OrganizationMeta): Promise<void> {
    const meta: OrgProfileMeta = {
      id: input.id.trim(),
      name: (input.name?.trim() || input.id).trim(),
      active: input.active,
      country: input.country?.trim(),
      updated:
        input.updated === undefined || input.updated === null
          ? new Date().toISOString()
          : String(input.updated).trim() || new Date().toISOString(),
      description: input.description ?? null,
    };
    await this.orgProfileRepo.putOrgProfile(meta);
  }
}
