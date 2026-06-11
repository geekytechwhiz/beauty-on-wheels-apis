import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { ORG_EDITABLE_STATUSES, type TemplateStatus } from '../constants/template.constants';
import { toOrgTemplateRulesResponse } from '../mappers/org-template-rules.dto';
import type {
  GetOrgTemplateRulesParams,
  UpdateOrgTemplateRulesParams,
} from '../models/api/org-template-rules.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { isActiveEnablement } from '../utils/enablement.utils';
import {
  asTemplateRulesMap,
  mergeOrgRulesPartial,
  OrgRulesValidationError,
} from '../utils/template-rules.utils';
import {
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
} from '../utils/template.utils';
import { OrgTemplateOpsService } from './org-template-ops.service';

function assertEditableStatus(status: TemplateStatus | undefined, action: string): void {
  if (!status || !ORG_EDITABLE_STATUSES.includes(status)) {
    templateConflictError(
      `Cannot ${action} org template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
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
      return toOrgTemplateRulesResponse(resolved.metaRow, resolved.versionRow, {
        organizationId: params.organizationId,
        masterTemplateId: resolved.masterTemplateId,
        templateEnabled: true,
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
      if (ruleKeys.length === 0) {
        templateValidationError('rules must contain at least one field path');
      }

      const resolved = await this.resolveEnabledOrgTemplate(params);
      const currentStatus = resolved.versionRow.meta?.status ?? resolved.metaRow.meta.status;
      assertEditableStatus(currentStatus, 'update rules');

      const existingRules = asTemplateRulesMap(resolved.versionRow.rules);
      const mergedRules = mergeOrgRulesPartial(existingRules, params.rules);

      const updatedVersion = await this.orgOps.saveOrgTemplateInPlace({
        organizationId: params.organizationId,
        templateId: resolved.orgTemplateId,
        metaRow: resolved.metaRow,
        sourceVersion: resolved.versionRow,
        mergedDocument: {
          ...this.orgOps.extractDocumentFields(resolved.versionRow),
          rules: mergedRules,
        },
        actorUser: params.actorUser,
        bumpVersion: true,
      });

      return toOrgTemplateRulesResponse(resolved.metaRow, updatedVersion, {
        organizationId: params.organizationId,
        masterTemplateId: resolved.masterTemplateId,
        templateEnabled: true,
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

    return { masterTemplateId, orgTemplateId, metaRow, versionRow };
  }
}
