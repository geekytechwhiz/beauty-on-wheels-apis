import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import {
  TEMPLATE_STATUS,
  type TemplateStatus,
} from '../constants/template.constants';
import { toOrgTemplateRulesResponse } from '../mappers/org-template-rules.dto';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type {
  GetOrgTemplateRulesParams,
  UpdateOrgTemplateRulesParams,
} from '../models/api/org-template-rules.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { isActiveEnablement } from '../utils/enablement.utils';
import {
  asTemplateRulesMap,
  buildRulesFromFieldValues,
  mergeOrgRulesPartial,
  mergeRulesAfterFieldValuesChange,
  OrgRulesValidationError,
} from '../utils/template-rules.utils';
import {
  resolveTemplateDisplayVersion,
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
} from '../utils/template.utils';
import { OrgTemplateOpsService } from './org-template-ops.service';
import { resolveCanonicalOrgUpgradeContext } from '../utils/org-canonical-org-upgrade.utils';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isFieldValuesRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasFieldValuesPatch(value: unknown): value is Record<string, unknown> {
  return isFieldValuesRecord(value) && Object.keys(value).length > 0;
}

function resolveMetaStatus(meta: TemplateDdbRecord['meta']): TemplateStatus {
  return (meta.status ?? TEMPLATE_STATUS.DRAFT) as TemplateStatus;
}

function buildOrgTemplateMetaOverrides(params: {
  status?: TemplateStatus;
  active?: boolean;
  currentMeta: TemplateMeta;
  nowIso: string;
}): Partial<TemplateMeta> {
  const overrides: Partial<TemplateMeta> = {};

  if (params.status !== undefined) {
    overrides.status = params.status;
    if (params.status === TEMPLATE_STATUS.PUBLISHED) {
      overrides.publishedAt = params.currentMeta.publishedAt ?? params.nowIso;
    }
    if (params.status === TEMPLATE_STATUS.DRAFT) {
      overrides.publishedAt = null;
    }
  }

  if (params.active !== undefined) {
    overrides.isActive = params.active;
  }

  return overrides;
}

function preserveMasterLineageOverrides(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
): Partial<TemplateMeta> {
  const lineage: Partial<TemplateMeta> = {};
  const derivedFromMasterVersion =
    versionRow.meta.derivedFromMasterVersion ?? metaRow.meta.derivedFromMasterVersion;
  if (typeof derivedFromMasterVersion === 'number' && derivedFromMasterVersion > 0) {
    lineage.derivedFromMasterVersion = derivedFromMasterVersion;
  }
  const derivedFromTemplateVersionId =
    versionRow.meta.derivedFromTemplateVersionId?.trim() ||
    metaRow.meta.derivedFromTemplateVersionId?.trim();
  if (derivedFromTemplateVersionId) {
    lineage.derivedFromTemplateVersionId = derivedFromTemplateVersionId;
  }
  const masterTemplateVersionId =
    versionRow.meta.masterTemplateVersionId?.trim() || metaRow.meta.masterTemplateVersionId?.trim();
  if (masterTemplateVersionId) {
    lineage.masterTemplateVersionId = masterTemplateVersionId;
  }
  return lineage;
}

export class OrgTemplateRulesService {
  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly enablementRepo = new EnablementRepository(),
    private readonly orgOps = new OrgTemplateOpsService(),
  ) {}

  async getOrgTemplateRules(params: GetOrgTemplateRulesParams) {
    try {
      const resolved = await this.resolveEnabledOrgTemplate(params);
      const upgradeCtx = resolveCanonicalOrgUpgradeContext(resolved.metaRow, resolved.versionRow);
      return toOrgTemplateRulesResponse(resolved.metaRow, resolved.versionRow, {
        organizationId: params.organizationId,
        masterTemplateId: resolved.masterTemplateId,
        templateEnabled: true,
        upgrade: upgradeCtx.upgrade,
        adopt: upgradeCtx.adopt,
      });
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  async updateOrgTemplateRules(params: UpdateOrgTemplateRulesParams) {
    try {
      const ruleKeys = Object.keys(params.rules ?? {});
      const hasFieldValues = hasFieldValuesPatch(params.fieldValues);
      const hasStatusPatch = params.status !== undefined;
      const hasActivePatch = params.active !== undefined;
      const hasAdopt = params.adopt === true;
      const nowIso = new Date().toISOString();

      if (
        !hasAdopt &&
        ruleKeys.length === 0 &&
        !hasFieldValues &&
        !hasStatusPatch &&
        !hasActivePatch
      ) {
        templateValidationError('rules, fieldValues, status, active, or adopt must be provided');
      }

      const resolved = await this.resolveEnabledOrgTemplate(params);
      let metaRow = resolved.metaRow;
      let versionRow = resolved.versionRow;

      if (hasAdopt) {
        const upgradeCtx = resolveCanonicalOrgUpgradeContext(metaRow, versionRow);
        if (!upgradeCtx.upgrade) {
          templateConflictError('No org template upgrade is available to adopt');
        }
        const currentVersion = resolveTemplateDisplayVersion(versionRow.meta);
        versionRow = await this.orgOps.saveOrgTemplateInPlace({
          organizationId: params.organizationId,
          templateId: resolved.orgTemplateId,
          metaRow,
          sourceVersion: versionRow,
          mergedDocument: this.orgOps.extractDocumentFields(versionRow),
          metaOverrides: {
            ...preserveMasterLineageOverrides(metaRow, versionRow),
            derivedFromMasterVersion: currentVersion,
          },
          actorUser: params.actorUser,
          bumpVersion: false,
        });
        const refreshedMeta = await this.orgRepo.getOrgMeta(
          params.organizationId,
          resolved.orgTemplateId,
        );
        if (!refreshedMeta) {
          templateNotFoundError('Org template not found');
        }
        metaRow = refreshedMeta;
      }

      const currentStatus = resolveMetaStatus(versionRow.meta ?? metaRow.meta);
      const metaOverrides = buildOrgTemplateMetaOverrides({
        status: params.status,
        active: params.active,
        currentMeta: metaRow.meta,
        nowIso,
      });
      const hasMetaPatch = hasStatusPatch || hasActivePatch;
      const contentPatch = ruleKeys.length > 0 || hasFieldValues;

      if (contentPatch) {
        const mergedDocument = {
          ...this.orgOps.extractDocumentFields(versionRow),
        };

        if (hasFieldValues) {
          mergedDocument.fieldValues = {
            ...asRecord(versionRow.fieldValues),
            ...params.fieldValues,
          };
        }

        const templateType = versionRow.meta?.templateType ?? metaRow.meta.templateType;

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
          organizationId: params.organizationId,
          templateId: resolved.orgTemplateId,
          metaRow,
          sourceVersion: versionRow,
          mergedDocument,
          metaOverrides: {
            ...preserveMasterLineageOverrides(metaRow, versionRow),
            ...metaOverrides,
            status: (params.status ?? currentStatus) as TemplateStatus,
          },
          actorUser: params.actorUser,
          bumpVersion: true,
        });

        const refreshedMeta = await this.orgRepo.getOrgMeta(
          params.organizationId,
          resolved.orgTemplateId,
        );
        if (!refreshedMeta) {
          templateNotFoundError('Org template not found');
        }
        metaRow = refreshedMeta;
      } else if (hasMetaPatch) {
        versionRow = await this.orgOps.saveOrgTemplateInPlace({
          organizationId: params.organizationId,
          templateId: resolved.orgTemplateId,
          metaRow,
          sourceVersion: versionRow,
          mergedDocument: this.orgOps.extractDocumentFields(versionRow),
          metaOverrides: {
            ...preserveMasterLineageOverrides(metaRow, versionRow),
            ...metaOverrides,
          },
          actorUser: params.actorUser,
          bumpVersion: false,
        });

        const refreshedMeta = await this.orgRepo.getOrgMeta(
          params.organizationId,
          resolved.orgTemplateId,
        );
        if (!refreshedMeta) {
          templateNotFoundError('Org template not found');
        }
        metaRow = refreshedMeta;
      }

      const upgradeCtx = resolveCanonicalOrgUpgradeContext(metaRow, versionRow);

      return toOrgTemplateRulesResponse(metaRow, versionRow, {
        organizationId: params.organizationId,
        masterTemplateId: resolved.masterTemplateId,
        templateEnabled: true,
        upgrade: upgradeCtx.upgrade,
        adopt: upgradeCtx.adopt,
      });
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  private async resolveEnabledOrgTemplate(params: {
    masterTemplateId: string;
    organizationId: string;
  }): Promise<{
    masterTemplateId: string;
    orgTemplateId: string;
    metaRow: TemplateDdbRecord;
    versionRow: TemplateDdbRecord;
    enablement: EnablementDdbRecord;
  }> {
    const masterTemplateId = TemplateEntityBuilder.normalizeTemplateId(params.masterTemplateId);
    const organizationId = params.organizationId.trim();
    const orgTemplateId = OrgTemplateEntityBuilder.buildOrgTemplateId(
      masterTemplateId,
      organizationId,
    );

    const enablement = await this.enablementRepo.findByOrgAndMasterTemplateId(
      organizationId,
      masterTemplateId,
    );
    if (!enablement || !isActiveEnablement(enablement)) {
      templateNotFoundError('Org template not found or not enabled for this master and organization');
    }

    const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
    if (!metaRow) {
      templateNotFoundError('Org template not found');
    }

    const versionRow = await this.orgRepo.getOrgVersionForMeta(
      organizationId,
      orgTemplateId,
      metaRow.meta,
    );
    if (!versionRow) {
      templateNotFoundError('Org template version not found');
    }

    return { masterTemplateId, orgTemplateId, metaRow, versionRow, enablement };
  }
}
