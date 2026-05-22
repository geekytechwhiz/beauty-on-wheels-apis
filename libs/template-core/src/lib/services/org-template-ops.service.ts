import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import {
  MASTER_EDITABLE_STATUSES,
  TEMPLATE_STATUS,
  type TemplateStatus,
} from '../constants/template.constants';
import { toTemplateSummary } from '../mappers/template-http.dto';
import type { UpdateOrgTemplateVersionParams } from '../models/api/org-update.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  normalizeVersionToSk,
  templateConflictError,
  templateNotFoundError,
} from '../utils/template.utils';

const META_ROW_KEYS = new Set([
  'pk',
  'sk',
  'entityType',
  'meta',
  'gsi1pk',
  'gsi1sk',
  'gsi2pk',
  'gsi2sk',
  'gsi3pk',
  'gsi3sk',
  'gsi4pk',
  'gsi4sk',
  'gsi5pk',
  'gsi5sk',
]);

function parseOrgUpdateBody(body: UpdateOrgTemplateVersionParams['body']): {
  metaOverrides: Partial<TemplateMeta>;
  documentFields: Record<string, unknown>;
} {
  const { meta, overrides, ...rest } = body;
  const metaOverrides: Partial<TemplateMeta> = {};
  if (meta && typeof meta === 'object') {
    Object.assign(metaOverrides, meta as Partial<TemplateMeta>);
    const desc = (meta as Record<string, unknown>).description;
    if (typeof desc === 'string' && !metaOverrides.templateDescription) {
      metaOverrides.templateDescription = desc;
    }
  }
  const documentFields: Record<string, unknown> = { ...rest };
  if (overrides && typeof overrides === 'object') {
    documentFields.overrides = overrides;
  }
  return { metaOverrides, documentFields };
}

function extractDocumentFields(record: TemplateDdbRecord): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!META_ROW_KEYS.has(key)) {
      doc[key] = value;
    }
  }
  return doc;
}

function assertEditableStatus(status: TemplateStatus | undefined, action: string): void {
  if (!status || !MASTER_EDITABLE_STATUSES.includes(status)) {
    templateConflictError(
      `Cannot ${action} org template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
}

export class OrgTemplateOpsService {
  constructor(private readonly orgRepo = new OrgTemplateRepository()) {}

  async updateOrgTemplateVersion(params: UpdateOrgTemplateVersionParams): Promise<TemplateDdbRecord> {
    try {
      const metaRow = await this.orgRepo.getOrgMeta(params.organizationId, params.templateId);
      if (!metaRow) {
        templateNotFoundError('Org template not found');
      }

      const sourceSk = normalizeVersionToSk(params.versionId);
      const sourceVersion = await this.orgRepo.getOrgVersion(
        params.organizationId,
        params.templateId,
        sourceSk,
      );
      if (!sourceVersion) {
        templateNotFoundError('Org template version not found');
      }

      const currentStatus = sourceVersion.meta?.status ?? metaRow.meta.status;
      assertEditableStatus(currentStatus, 'update');

      const nextVersionNum = (metaRow.meta.version ?? 1) + 1;
      const ctx = TemplateEntityBuilder.buildVersionWriteContext(
        params.templateId,
        nextVersionNum,
      );
      const { metaOverrides, documentFields } = parseOrgUpdateBody(params.body);
      const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
        metaRow.meta,
        {
          ...metaOverrides,
          status: (metaOverrides.status ?? currentStatus) as TemplateStatus,
          ownerOrgId: params.organizationId,
          isMaster: false,
        },
        ctx,
        params.actorUserId,
      );

      const mergedDocument = {
        ...extractDocumentFields(sourceVersion),
        ...documentFields,
      };

      const newMetaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
        mergedMeta,
        params.organizationId,
        params.templateId,
      );
      const newVersionRow = OrgTemplateEntityBuilder.buildOrgVersionRowFromMeta(
        mergedMeta,
        params.organizationId,
        params.templateId,
        ctx,
        mergedDocument,
      );

      await this.orgRepo.saveOrgMetaAndVersion(newMetaRow, newVersionRow, {
        requireNewVersionSk: true,
      });

      return newVersionRow;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
