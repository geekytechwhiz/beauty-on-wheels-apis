import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type {
  CreateOrgEnablementParams,
  EnablementDdbRecord,
  ListOrgEnablementsByOrgParams,
  OrgEnablementDto,
  OrgEnablementListResult,
  SearchOrgEnablementsParams,
  UpdateOrgEnablementParams,
} from '../models/api/enablement.types';
import { EnablementRepository } from '../repositories/enablement.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { isActiveEnablement } from '../utils/enablement.utils';
import {
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
  templateVersionIdToSk,
} from '../utils/template.utils';

function parseTemplateIdFromVersionId(templateVersionId: string): string | undefined {
  const match = templateVersionId.trim().match(/^(.+)-V\d+$/i);
  return match?.[1];
}

export class EnablementService {
  constructor(
    private readonly enablementRepo = new EnablementRepository(),
    private readonly templateRepo = new TemplateRepository(),
  ) {}

  async createOrgEnablement(params: CreateOrgEnablementParams): Promise<OrgEnablementDto> {
    try {
      const { body } = params;
      if (!body.organizationId?.trim() || !body.masterTemplateVersionId?.trim()) {
        templateValidationError('organizationId and masterTemplateVersionId are required');
      }

      const parsedTemplateId = parseTemplateIdFromVersionId(body.masterTemplateVersionId);
      if (!parsedTemplateId) {
        templateValidationError('Invalid masterTemplateVersionId format');
      }
      const templateId = TemplateEntityBuilder.normalizeTemplateId(parsedTemplateId);

      const sk = templateVersionIdToSk(body.masterTemplateVersionId);
      if (!sk) {
        templateValidationError('Invalid masterTemplateVersionId format');
      }

      const masterVersion = await this.templateRepo.getMasterVersion(templateId, sk);
      if (!masterVersion) {
        templateNotFoundError('Master template version not found');
      }

      if (masterVersion.meta?.status !== TEMPLATE_STATUS.PUBLISHED) {
        templateConflictError(
          `Only PUBLISHED master templates can be enabled; current status is ${masterVersion.meta?.status ?? 'UNKNOWN'}`,
        );
      }

      const existing = await this.enablementRepo.findByOrgAndMasterTemplateId(
        body.organizationId,
        templateId,
      );
      if (existing) {
        templateConflictError(
          `Enablement already exists for organization ${body.organizationId} and master template ${templateId}`,
        );
      }

      const nowIso = new Date().toISOString();
      const enablementId = EnablementEntityBuilder.buildEnablementId(body.organizationId);
      const meta = EnablementEntityBuilder.buildMeta(body, masterVersion, enablementId, nowIso);
      const row = EnablementEntityBuilder.buildRow(meta);

      await this.enablementRepo.putEnablement(row);
      return this.toDto(row);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async searchOrgEnablements(params: SearchOrgEnablementsParams): Promise<OrgEnablementListResult> {
    try {
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const orgId = params.organizationId?.trim();
      const masterVer = params.masterTemplateVersionId?.trim();

      if (!orgId && !masterVer) {
        templateValidationError(
          'At least one of organizationId or masterTemplateVersionId query parameter is required',
        );
      }

      let records: EnablementDdbRecord[];

      if (masterVer && !orgId) {
        records = await this.enablementRepo.queryEnablementsByMasterVersionGsi3(masterVer, limit);
      } else if (orgId) {
        records = await this.enablementRepo.queryEnablementsByOrgGsi1(orgId, limit);
        if (masterVer) {
          records = records.filter((r) => r.meta.masterTemplateVersionId === masterVer);
        }
      } else {
        records = [];
      }

      return {
        organizationMeta: {
          id: orgId ?? '',
          name: orgId ?? '',
          description: null,
        },
        items: records.filter(isActiveEnablement).map((r) => this.toDto(r)),
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listOrgEnablementsByOrg(
    params: ListOrgEnablementsByOrgParams,
  ): Promise<OrgEnablementListResult> {
    try {
      const limit = Math.min(100, Math.max(1, params.limit ?? 100));
      const records = await this.enablementRepo.queryEnablementsByOrgGsi1(
        params.organizationId,
        limit,
      );
      const organizationMeta = {
        id: params.organizationId,
        name: params.organizationName?.trim() || params.organizationId,
        description: params.organizationDescription?.trim() || null,
      };
      return {
        organizationMeta,
        items: records.filter(isActiveEnablement).map((r) => this.toDto(r)),
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async getOrgEnablementById(enablementId: string): Promise<OrgEnablementDto> {
    try {
      const record = await this.enablementRepo.getEnablement(enablementId);
      if (!record) {
        templateNotFoundError('Org enablement not found');
      }
      return this.toDto(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async updateOrgEnablement(
    params: UpdateOrgEnablementParams,
  ): Promise<OrgEnablementDto | null> {
    try {
      const action = params.body.action ?? 'UPDATE';
      const record = await this.enablementRepo.getEnablement(params.enablementId);
      if (!record) {
        templateNotFoundError('Org enablement not found');
      }

      if (action === 'REVOKE') {
        await this.enablementRepo.deleteEnablement(params.enablementId);
        return null;
      }

      const hasFrom = params.body.effectiveFrom !== undefined && params.body.effectiveFrom !== null;
      const hasTo = params.body.effectiveTo !== undefined;
      if (!hasFrom && !hasTo) {
        templateValidationError(
          'At least one of effectiveFrom or effectiveTo is required when action is UPDATE',
        );
      }

      const updated = EnablementEntityBuilder.applyDateUpdates(record, {
        effectiveFrom: params.body.effectiveFrom,
        effectiveTo: params.body.effectiveTo,
      });
      await this.enablementRepo.putEnablementOverwrite(updated);
      return this.toDto(updated);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  toDto(record: EnablementDdbRecord): OrgEnablementDto {
    const meta = record.meta;
    const masterTemplateId =
      meta.masterTemplateId?.trim() ||
      parseTemplateIdFromVersionId(meta.masterTemplateVersionId) ||
      '';
    return {
      enablementId: meta.enablementId,
      organizationId: meta.organizationId,
      masterTemplateId,
      masterTemplateVersionId: meta.masterTemplateVersionId,
      orgTemplateId: meta.orgTemplateId ?? '',
      templateName: meta.templateName ?? null,
      templateType: meta.templateType ?? null,
      categoryCode: meta.categoryCode ?? null,
      conditionCode: meta.conditionCode ?? meta.condition ?? null,
      condition: meta.condition ?? null,
      templateEnabled: isActiveEnablement(record),
      effectiveFrom: meta.effectiveFrom,
      effectiveTo: meta.effectiveTo ?? null,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt ?? null,
    };
  }
}
