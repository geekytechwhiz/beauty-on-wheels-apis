import {
  TemplateEntityBuilder,
  type MasterVersionWriteContext,
} from '../builder/template-entity.builder';
import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import {
  ORG_EDITABLE_STATUSES,
  STATUS_TRANSITION_ACTION,
  TEMPLATE_STATUS,
  type TemplateStatus,
} from '../constants/template.constants';
import { appendVersionHistoryToRecord, toTemplateSummary } from '../mappers/template-http.dto';
import type {
  TransitionOrgStatusParams,
  UpdateOrgTemplateVersionParams,
} from '../models/api/org-update.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  buildRulesFromFieldValues,
  mergeRulesAdditive,
} from '../utils/template-rules.utils';
import {
  bumpMinorVersion,
  normalizeVersionToSk,
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
  templateVersionIdToSk,
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function shouldBumpOrgVersionOnUpdate(documentFields: Record<string, unknown>): boolean {
  return Object.keys(documentFields).length > 0;
}

function assertEditableStatus(status: TemplateStatus | undefined, action: string): void {
  if (!status || !ORG_EDITABLE_STATUSES.includes(status)) {
    templateConflictError(
      `Cannot ${action} org template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
}

export class OrgTemplateOpsService {
  constructor(private readonly orgRepo = new OrgTemplateRepository()) {}

  extractDocumentFields(record: TemplateDdbRecord): Record<string, unknown> {
    return extractDocumentFields(record);
  }

  async saveOrgTemplateInPlace(params: {
    organizationId: string;
    templateId: string;
    metaRow: TemplateDdbRecord;
    sourceVersion: TemplateDdbRecord;
    mergedDocument: Record<string, unknown>;
    metaOverrides?: Partial<TemplateMeta>;
    actorUser?: import('../models/template-actor.model').TemplateActorUser;
    bumpVersion?: boolean;
  }): Promise<TemplateDdbRecord> {
    const currentStatus =
      params.sourceVersion.meta?.status ?? params.metaRow.meta.status ?? TEMPLATE_STATUS.DRAFT;
    const nowIso = new Date().toISOString();
    const bumpVersion = params.bumpVersion !== false;
    const nextVersionNum = bumpVersion
      ? bumpMinorVersion(params.metaRow.meta.version ?? params.sourceVersion.meta.version ?? 1)
      : (params.metaRow.meta.version ?? params.sourceVersion.meta.version ?? 1);

    const writeCtx: MasterVersionWriteContext = {
      templateId: params.templateId,
      templateVersionId: params.sourceVersion.meta.templateVersionId,
      versionNum: nextVersionNum,
      versionSk: params.sourceVersion.sk,
      nowIso,
    };

    const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
      params.metaRow.meta,
      {
        ...params.metaOverrides,
        status: (params.metaOverrides?.status ?? currentStatus) as TemplateStatus,
        ownerOrgId: params.organizationId,
        isMaster: false,
      },
      writeCtx,
      params.actorUser,
    );

    const updatedMetaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
      mergedMeta,
      params.organizationId,
      params.templateId,
    );
    const updatedVersionRow = OrgTemplateEntityBuilder.buildOrgVersionRowFromMeta(
      mergedMeta,
      params.organizationId,
      params.templateId,
      writeCtx,
      params.mergedDocument,
    );

    if (bumpVersion) {
      appendVersionHistoryToRecord(updatedVersionRow);
    }

    await this.orgRepo.saveOrgMetaAndVersion(updatedMetaRow, updatedVersionRow);
    return updatedVersionRow;
  }

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

      const { metaOverrides, documentFields } = parseOrgUpdateBody(params.body);
      const mergedDocument = {
        ...extractDocumentFields(sourceVersion),
        ...documentFields,
      };

      if (documentFields.fieldValues !== undefined) {
        mergedDocument.rules = mergeRulesAdditive(
          asRecord(sourceVersion.rules),
          buildRulesFromFieldValues(asRecord(mergedDocument.fieldValues)),
        );
      }

      return await this.saveOrgTemplateInPlace({
        organizationId: params.organizationId,
        templateId: params.templateId,
        metaRow,
        sourceVersion,
        mergedDocument,
        metaOverrides: {
          ...metaOverrides,
          status: (metaOverrides.status ?? currentStatus) as TemplateStatus,
        },
        actorUser: params.actorUser,
        bumpVersion: shouldBumpOrgVersionOnUpdate(documentFields),
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async transitionOrgTemplateStatus(params: TransitionOrgStatusParams): Promise<TemplateDdbRecord> {
    try {
      const action = params.body.action?.trim().toUpperCase();
      if (!action) {
        templateValidationError('action is required');
      }

      const metaRow = await this.orgRepo.getOrgMeta(params.organizationId, params.templateId);
      if (!metaRow) {
        templateNotFoundError('Org template not found');
      }

      const versionSk = normalizeVersionToSk(params.versionId);
      const versionRow = await this.orgRepo.getOrgVersion(
        params.organizationId,
        params.templateId,
        versionSk,
      );
      if (!versionRow) {
        templateNotFoundError('Org template version not found');
      }

      const nowIso = new Date().toISOString();
      const currentStatus = versionRow.meta?.status ?? metaRow.meta.status ?? TEMPLATE_STATUS.DRAFT;

      this.assertTransitionTargetsCurrentVersion(metaRow, versionRow, versionSk);

      if (action === STATUS_TRANSITION_ACTION.SUBMIT_REVIEW) {
        if (currentStatus !== TEMPLATE_STATUS.DRAFT && currentStatus !== TEMPLATE_STATUS.SAVED) {
          templateConflictError(`SUBMIT_REVIEW requires DRAFT or SAVED; current status is ${currentStatus}`);
        }
        return await this.applyOrgMetaAndVersionStatus(
          metaRow,
          versionRow,
          params.organizationId,
          TEMPLATE_STATUS.IN_REVIEW,
          nowIso,
          params.actorUser,
          params.body.comment,
        );
      }

      if (action === STATUS_TRANSITION_ACTION.REJECT) {
        if (currentStatus !== TEMPLATE_STATUS.IN_REVIEW) {
          templateConflictError(`REJECT requires IN_REVIEW; current status is ${currentStatus}`);
        }
        if (!params.body.reason?.trim()) {
          templateValidationError('reason is required when action is REJECT');
        }
        return await this.applyOrgMetaAndVersionStatus(
          metaRow,
          versionRow,
          params.organizationId,
          TEMPLATE_STATUS.DRAFT,
          nowIso,
          params.actorUser,
          params.body.reason,
        );
      }

      if (action === STATUS_TRANSITION_ACTION.PUBLISH) {
        if (currentStatus !== TEMPLATE_STATUS.IN_REVIEW) {
          templateConflictError(`PUBLISH requires IN_REVIEW; current status is ${currentStatus}`);
        }
        return await this.publishOrgTemplate(
          metaRow,
          versionRow,
          params.organizationId,
          nowIso,
          params.actorUser,
          params.body.comment,
        );
      }

      if (action === STATUS_TRANSITION_ACTION.ARCHIVE) {
        if (currentStatus !== TEMPLATE_STATUS.PUBLISHED) {
          templateConflictError(`ARCHIVE requires PUBLISHED; current status is ${currentStatus}`);
        }
        return await this.applyOrgMetaAndVersionStatus(
          metaRow,
          versionRow,
          params.organizationId,
          TEMPLATE_STATUS.ARCHIVED,
          nowIso,
          params.actorUser,
          params.body.comment,
        );
      }

      if (action === STATUS_TRANSITION_ACTION.DEPRECATE) {
        if (currentStatus !== TEMPLATE_STATUS.PUBLISHED) {
          templateConflictError(`DEPRECATE requires PUBLISHED; current status is ${currentStatus}`);
        }
        return await this.applyOrgMetaAndVersionStatus(
          metaRow,
          versionRow,
          params.organizationId,
          TEMPLATE_STATUS.DEPRECATED,
          nowIso,
          params.actorUser,
          params.body.comment,
        );
      }

      templateValidationError(`Unknown action: ${action}`);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private assertTransitionTargetsCurrentVersion(
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    targetVersionSk: string,
  ): void {
    const metaPointerSk = templateVersionIdToSk(metaRow.meta.templateVersionId ?? '');
    if (metaPointerSk && metaPointerSk !== targetVersionSk) {
      templateConflictError(
        `Status transition must target the current META version ${metaRow.meta.templateVersionId} (${metaPointerSk}), not ${versionRow.meta.templateVersionId}`,
      );
    }
  }

  private async applyOrgMetaAndVersionStatus(
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    organizationId: string,
    status: TemplateStatus,
    nowIso: string,
    actor?: import('../models/template-actor.model').TemplateActorUser,
    note?: string | null,
  ): Promise<TemplateDdbRecord> {
    const writeCtx: MasterVersionWriteContext = {
      templateId: metaRow.meta.templateId,
      templateVersionId: versionRow.meta.templateVersionId,
      versionNum: versionRow.meta.version ?? 1,
      versionSk: versionRow.sk,
      nowIso,
    };

    const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
      metaRow.meta,
      {
        status,
        reviewComments: note ?? metaRow.meta.reviewComments,
        publishedBy: status === TEMPLATE_STATUS.PUBLISHED ? actor : metaRow.meta.publishedBy,
        ownerOrgId: organizationId,
        isMaster: false,
      },
      writeCtx,
      actor,
    );

    const updatedMetaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
      mergedMeta,
      organizationId,
      metaRow.meta.templateId,
    );
    const updatedVersionRow = OrgTemplateEntityBuilder.buildOrgVersionRowFromMeta(
      mergedMeta,
      organizationId,
      metaRow.meta.templateId,
      writeCtx,
      extractDocumentFields(versionRow),
    );

    await this.orgRepo.saveOrgMetaAndVersion(updatedMetaRow, updatedVersionRow);
    return updatedVersionRow;
  }

  private async publishOrgTemplate(
    metaRow: TemplateDdbRecord,
    sourceVersion: TemplateDdbRecord,
    organizationId: string,
    nowIso: string,
    actor?: import('../models/template-actor.model').TemplateActorUser,
    comment?: string | null,
  ): Promise<TemplateDdbRecord> {
    const nextVersionNum = (metaRow.meta.version ?? 1) + 1;
    const ctx = TemplateEntityBuilder.buildVersionWriteContext(
      metaRow.meta.templateId,
      nextVersionNum,
      nowIso,
    );
    const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
      metaRow.meta,
      {
        status: TEMPLATE_STATUS.PUBLISHED,
        publishedAt: nowIso,
        publishedBy: actor,
        reviewComments: comment ?? metaRow.meta.reviewComments,
        ownerOrgId: organizationId,
        isMaster: false,
      },
      ctx,
      actor,
    );

    const documentFields = extractDocumentFields(sourceVersion);
    const newMetaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
      mergedMeta,
      organizationId,
      metaRow.meta.templateId,
    );
    const newVersionRow = OrgTemplateEntityBuilder.buildOrgVersionRowFromMeta(
      mergedMeta,
      organizationId,
      metaRow.meta.templateId,
      ctx,
      documentFields,
    );

    await this.orgRepo.saveOrgMetaAndVersion(newMetaRow, newVersionRow, { requireNewVersionSk: true });
    return newVersionRow;
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
