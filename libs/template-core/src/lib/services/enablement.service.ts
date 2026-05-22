import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import type {
  CreateOrgEnablementParams,
  EnablementDdbRecord,
  OrgEnablementDto,
} from '../models/api/enablement.types';
import { EnablementRepository } from '../repositories/enablement.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
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

      const templateId = parseTemplateIdFromVersionId(body.masterTemplateVersionId);
      if (!templateId) {
        templateValidationError('Invalid masterTemplateVersionId format');
      }

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

      const existing = await this.enablementRepo.findByOrgAndMasterVersion(
        body.organizationId,
        body.masterTemplateVersionId,
      );
      if (existing) {
        templateConflictError(
          `Enablement already exists for organization ${body.organizationId} and version ${body.masterTemplateVersionId}`,
        );
      }

      const nowIso = new Date().toISOString();
      const enablementId = EnablementEntityBuilder.buildEnablementId(body.organizationId);
      const meta = EnablementEntityBuilder.buildMeta(
        body,
        masterVersion,
        enablementId,
        nowIso,
      );
      const row = EnablementEntityBuilder.buildRow(meta);

      await this.enablementRepo.putEnablement(row);
      return this.toDto(row);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  toDto(record: EnablementDdbRecord): OrgEnablementDto {
    const meta = record.meta;
    return {
      enablementId: meta.enablementId,
      organizationId: meta.organizationId,
      masterTemplateVersionId: meta.masterTemplateVersionId,
      templateName: meta.templateName ?? null,
      condition: meta.condition ?? null,
      effectiveFrom: meta.effectiveFrom,
      effectiveTo: meta.effectiveTo ?? null,
      createdAt: meta.createdAt,
    };
  }
}
