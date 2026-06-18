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
  buildRulesFromFieldValues,
  mergeOrgRulesPartial,
  mergeRulesAfterFieldValuesChange,
  OrgRulesValidationError,
} from '../utils/template-rules.utils';
import {
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
} from '../utils/template.utils';
import { OrgTemplateOpsService } from './org-template-ops.service';

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
      const hasFieldValues = hasFieldValuesPatch(params.fieldValues);
      if (ruleKeys.length === 0 && !hasFieldValues) {
        templateValidationError('rules or fieldValues must contain at least one field');
      }

      const resolved = await this.resolveEnabledOrgTemplate(params);
      const currentStatus = resolved.versionRow.meta?.status ?? resolved.metaRow.meta.status;
      assertEditableStatus(currentStatus, 'update rules');

      const mergedDocument = {
        ...this.orgOps.extractDocumentFields(resolved.versionRow),
      };

      if (hasFieldValues) {
        mergedDocument.fieldValues = {
          ...asRecord(resolved.versionRow.fieldValues),
          ...params.fieldValues,
        };
      }

      const templateType =
        resolved.versionRow.meta?.templateType ?? resolved.metaRow.meta.templateType;

      let nextRules = asTemplateRulesMap(resolved.versionRow.rules);
      if (hasFieldValues) {
        nextRules = mergeRulesAfterFieldValuesChange(
          asRecord(resolved.versionRow.rules),
          buildRulesFromFieldValues(asRecord(mergedDocument.fieldValues), { templateType }),
          {
            templateType,
            fieldValues: asRecord(mergedDocument.fieldValues),
            previousFieldValues: asRecord(resolved.versionRow.fieldValues),
          },
        );
      }

      if (ruleKeys.length > 0) {
        nextRules = mergeOrgRulesPartial(nextRules, params.rules!);
      }

      mergedDocument.rules = nextRules;

      const updatedVersion = await this.orgOps.saveOrgTemplateInPlace({
        organizationId: params.organizationId,
        templateId: resolved.orgTemplateId,
        metaRow: resolved.metaRow,
        sourceVersion: resolved.versionRow,
        mergedDocument,
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
