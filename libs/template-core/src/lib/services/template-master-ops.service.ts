import {
  TemplateEntityBuilder,
  type MasterVersionWriteContext,
} from '../builder/template-entity.builder';
import {
  MASTER_EDITABLE_STATUSES,
  STATUS_TRANSITION_ACTION,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  type TemplateStatus,
} from '../constants/template.constants';
import { toTemplateSummary } from '../mappers/template-http.dto';
import type {
  MasterTemplateUpdateBody,
  TransitionMasterStatusParams,
  UpdateMasterVersionParams,
} from '../models/api/master-version-ops.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { TemplateRepository } from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { normalizeShareScopeOrThrow } from '../utils/share-scope.utils';
import {
  firstString,
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseUpdateBody(body: MasterTemplateUpdateBody): {
  metaOverrides: Partial<TemplateMeta>;
  documentFields: Record<string, unknown>;
} {
  const { meta, ...rest } = body;
  const metaOverrides: Partial<TemplateMeta> = {};
  if (meta && typeof meta === 'object') {
    Object.assign(metaOverrides, meta as Partial<TemplateMeta>);
    const desc = (meta as Record<string, unknown>).description;
    if (typeof desc === 'string' && !metaOverrides.templateDescription) {
      metaOverrides.templateDescription = desc;
    }
  }

  if (typeof rest.shareScope === 'string' && rest.shareScope.trim()) {
    metaOverrides.shareScope = normalizeShareScopeOrThrow(rest.shareScope);
  }
  if (typeof rest.templateName === 'string' && rest.templateName.trim()) {
    metaOverrides.templateName = rest.templateName.trim();
  }
  const fieldValues = asRecord(rest.fieldValues);
  const taskName = firstString(fieldValues.TASK_NAME) ?? firstString(fieldValues.TEMPLATE_NAME);
  if (taskName) {
    metaOverrides.templateName = taskName;
  }
  if (typeof rest.categoryCode === 'string' && rest.categoryCode.trim()) {
    metaOverrides.category = rest.categoryCode.trim();
  } else if (rest.category !== undefined) {
    metaOverrides.category = rest.category as TemplateMeta['category'];
  }
  if (typeof rest.conditionCode === 'string' && rest.conditionCode.trim()) {
    metaOverrides.condition = rest.conditionCode.trim();
  } else if (rest.condition !== undefined) {
    metaOverrides.condition = rest.condition as TemplateMeta['condition'];
  }

  return { metaOverrides, documentFields: rest };
}

function mergeDocumentFields(
  sourceVersion: TemplateDdbRecord,
  documentFields: Record<string, unknown>,
): Record<string, unknown> {
  const base = extractDocumentFields(sourceVersion);
  const merged: Record<string, unknown> = { ...base, ...documentFields };
  if (documentFields.fieldValues && typeof documentFields.fieldValues === 'object') {
    merged.fieldValues = {
      ...asRecord(base.fieldValues),
      ...asRecord(documentFields.fieldValues),
    };
  }
  return merged;
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
      `Cannot ${action} template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
}

export class TemplateMasterOpsService {
  constructor(private readonly repo = new TemplateRepository()) {}

  async updateMasterTemplateVersion(params: UpdateMasterVersionParams): Promise<TemplateDdbRecord> {
    try {
      const metaRow = await this.repo.getMasterMeta(params.templateId);
      if (!metaRow) {
        templateNotFoundError();
      }

      const sourceSk = normalizeVersionToSk(params.versionId);
      const sourceVersion = await this.repo.getMasterVersion(params.templateId, sourceSk);
      if (!sourceVersion) {
        templateNotFoundError('Master template version not found');
      }

      const currentStatus = sourceVersion.meta?.status ?? metaRow.meta.status;
      assertEditableStatus(currentStatus, 'update');

      const { metaOverrides, documentFields } = parseUpdateBody(params.body);
      const mergedDocument = mergeDocumentFields(sourceVersion, documentFields);
      const separateMeta = this.usesSeparateMetaRow(metaRow);

      if (!separateMeta) {
        const nowIso = new Date().toISOString();
        const inPlaceCtx: MasterVersionWriteContext = {
          templateId: params.templateId,
          templateVersionId: sourceVersion.meta.templateVersionId,
          versionNum: sourceVersion.meta.version ?? 1,
          versionSk: sourceVersion.sk,
          nowIso,
        };
        const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
          sourceVersion.meta,
          {
            ...metaOverrides,
            status: (metaOverrides.status ?? currentStatus) as TemplateStatus,
          },
          inPlaceCtx,
          params.actorUserId,
        );
        const updatedRow = TemplateEntityBuilder.buildVersionRowFromMeta(
          mergedMeta,
          inPlaceCtx,
          mergedDocument,
        );
        await this.repo.putMasterRecord(updatedRow);
        return updatedRow;
      }

      const nextVersionNum = (metaRow.meta.version ?? 1) + 1;
      const ctx = TemplateEntityBuilder.buildVersionWriteContext(
        params.templateId,
        nextVersionNum,
      );
      const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
        metaRow.meta,
        {
          ...metaOverrides,
          status: (metaOverrides.status ?? currentStatus) as TemplateStatus,
        },
        ctx,
        params.actorUserId,
      );

      const newMetaRow = TemplateEntityBuilder.buildMetaRowFromMeta(mergedMeta, params.templateId);
      const newVersionRow = TemplateEntityBuilder.buildVersionRowFromMeta(
        mergedMeta,
        ctx,
        mergedDocument,
      );

      await this.repo.saveMasterMetaAndVersion(newMetaRow, newVersionRow, {
        requireNewVersionSk: true,
      });

      return newVersionRow;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async transitionMasterTemplateStatus(
    params: TransitionMasterStatusParams,
  ): Promise<TemplateDdbRecord> {
    try {
      const action = params.body.action?.trim().toUpperCase();
      if (!action) {
        templateValidationError('action is required');
      }

      const metaRow = await this.repo.getMasterMeta(params.templateId);
      if (!metaRow) {
        templateNotFoundError();
      }

      const versionSk = normalizeVersionToSk(params.versionId);
      const versionRow = await this.repo.getMasterVersion(params.templateId, versionSk);
      if (!versionRow) {
        templateNotFoundError('Master template version not found');
      }

      const nowIso = new Date().toISOString();
      const currentStatus = versionRow.meta?.status ?? metaRow.meta.status ?? TEMPLATE_STATUS.DRAFT;

      this.assertTransitionTargetsCurrentVersion(metaRow, versionRow, versionSk);

      if (action === STATUS_TRANSITION_ACTION.SUBMIT_REVIEW) {
        if (currentStatus !== TEMPLATE_STATUS.DRAFT && currentStatus !== TEMPLATE_STATUS.SAVED) {
          templateConflictError(`SUBMIT_REVIEW requires DRAFT or SAVED; current status is ${currentStatus}`);
        }
        return await this.applyMetaAndVersionStatus(
          metaRow,
          versionRow,
          TEMPLATE_STATUS.IN_REVIEW,
          nowIso,
          params.actorUserId,
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
        return await this.applyMetaAndVersionStatus(
          metaRow,
          versionRow,
          TEMPLATE_STATUS.DRAFT,
          nowIso,
          params.actorUserId,
          params.body.reason,
        );
      }

      if (action === STATUS_TRANSITION_ACTION.PUBLISH) {
        if (currentStatus !== TEMPLATE_STATUS.IN_REVIEW) {
          templateConflictError(`PUBLISH requires IN_REVIEW; current status is ${currentStatus}`);
        }
        return await this.publishMasterTemplate(metaRow, versionRow, nowIso, params.actorUserId, params.body.comment);
      }

      if (action === STATUS_TRANSITION_ACTION.ARCHIVE) {
        if (currentStatus !== TEMPLATE_STATUS.PUBLISHED) {
          templateConflictError(`ARCHIVE requires PUBLISHED; current status is ${currentStatus}`);
        }
        return await this.applyMetaAndVersionStatus(
          metaRow,
          versionRow,
          TEMPLATE_STATUS.ARCHIVED,
          nowIso,
          params.actorUserId,
          params.body.comment,
        );
      }

      if (action === STATUS_TRANSITION_ACTION.DEPRECATE) {
        if (currentStatus !== TEMPLATE_STATUS.PUBLISHED) {
          templateConflictError(`DEPRECATE requires PUBLISHED; current status is ${currentStatus}`);
        }
        return await this.applyMetaAndVersionStatus(
          metaRow,
          versionRow,
          TEMPLATE_STATUS.DEPRECATED,
          nowIso,
          params.actorUserId,
          params.body.comment,
        );
      }

      templateValidationError(`Unknown action: ${action}`);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  /**
   * Lifecycle transitions apply to the VERSION row in the path. META must stay aligned with that
   * row (status, templateVersionId, version) so GET /meta and GET /versions?version=latest agree.
   */
  private assertTransitionTargetsCurrentVersion(
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    targetVersionSk: string,
  ): void {
    if (metaRow.sk !== TEMPLATE_META_SK) {
      if (metaRow.sk !== targetVersionSk) {
        templateConflictError(
          `Status transition must target the current version (${metaRow.sk}), not ${targetVersionSk}`,
        );
      }
      return;
    }
    const metaPointerSk = templateVersionIdToSk(metaRow.meta.templateVersionId ?? '');
    if (metaPointerSk && metaPointerSk !== targetVersionSk) {
      templateConflictError(
        `Status transition must target the current META version ${metaRow.meta.templateVersionId} (${metaPointerSk}), not ${versionRow.meta.templateVersionId}`,
      );
    }
  }

  private usesSeparateMetaRow(metaRow: TemplateDdbRecord): boolean {
    return metaRow.sk === TEMPLATE_META_SK;
  }

  private async applyMetaAndVersionStatus(
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    status: TemplateStatus,
    nowIso: string,
    actorUserId?: string,
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
        publishedBy: status === TEMPLATE_STATUS.PUBLISHED ? actorUserId : metaRow.meta.publishedBy,
      },
      writeCtx,
      actorUserId,
    );

    const updatedMetaRow = TemplateEntityBuilder.buildMetaRowFromMeta(mergedMeta, metaRow.meta.templateId);
    const updatedVersionRow = TemplateEntityBuilder.buildVersionRowFromMeta(
      mergedMeta,
      writeCtx,
      extractDocumentFields(versionRow),
    );

    if (this.usesSeparateMetaRow(metaRow)) {
      await this.repo.saveMasterMetaAndVersion(updatedMetaRow, updatedVersionRow);
    } else {
      await this.repo.putMasterRecord(updatedVersionRow);
    }
    return updatedVersionRow;
  }

  private async publishMasterTemplate(
    metaRow: TemplateDdbRecord,
    sourceVersion: TemplateDdbRecord,
    nowIso: string,
    actorUserId?: string,
    comment?: string | null,
  ): Promise<TemplateDdbRecord> {
    const nextVersionNum = (metaRow.meta.version ?? 1) + 1;
    const ctx = TemplateEntityBuilder.buildVersionWriteContext(metaRow.meta.templateId, nextVersionNum, nowIso);
    const mergedMeta = TemplateEntityBuilder.buildMetaFromExisting(
      metaRow.meta,
      {
        status: TEMPLATE_STATUS.PUBLISHED,
        publishedAt: nowIso,
        publishedBy: actorUserId,
        reviewComments: comment ?? metaRow.meta.reviewComments,
      },
      ctx,
      actorUserId,
    );

    const documentFields = extractDocumentFields(sourceVersion);
    const newMetaRow = TemplateEntityBuilder.buildMetaRowFromMeta(mergedMeta, metaRow.meta.templateId);
    const newVersionRow = TemplateEntityBuilder.buildVersionRowFromMeta(mergedMeta, ctx, documentFields);

    if (this.usesSeparateMetaRow(metaRow)) {
      await this.repo.saveMasterMetaAndVersion(newMetaRow, newVersionRow, { requireNewVersionSk: true });
    } else {
      await this.repo.putMasterRecord(newVersionRow);
    }
    return newVersionRow;
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
