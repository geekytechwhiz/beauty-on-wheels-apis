import {
  TemplateEntityBuilder,
  type CreateMasterTemplateInput,
} from '../builder/template-entity.builder';
import {
  buildHistoryByTemplateId,
  buildVersionHistory,
  toMasterListItem,
  toTemplateSummary,
  toVersionSummary,
} from '../mappers/template-http.dto';
import type {
  GetMasterVersionsParams,
  GetMasterVersionsResult,
  VersionResolveStrategy,
} from '../models/api/get-master-versions.types';
import type {
  ListFilterOptions,
  ListMasterTemplatesParams,
  ListMasterTemplatesResult,
  ListStatusCounts,
} from '../models/api/list-master.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { SHARE_SCOPE, TEMPLATE_STATUS } from '../constants/template.constants';
import {
  listMasterNextToken,
  TemplateRepository,
} from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { normalizeShareScope } from '../utils/share-scope.utils';
import {
  decodeListCursor,
  encodeListCursor,
  firstString,
  normalizeVersionToSk,
  pickHighestVersionRow,
  templateNotFoundError,
  templateVersionIdToSk,
} from '../utils/template.utils';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SAVED: 'Saved',
  IN_REVIEW: 'In Review',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  DEPRECATED: 'Deprecated',
};

const SCOPE_LABELS: Record<string, string> = {
  PRIVATE: 'Private',
  ORGANIZATION: 'Organization',
  PUBLIC: 'Public',
};

const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

/** Reduce all VERSION rows to one representative row per template (its highest version). */
function representativePerTemplate(rows: TemplateDdbRecord[]): TemplateDdbRecord[] {
  const byId = new Map<string, TemplateDdbRecord>();
  for (const row of rows) {
    const id = row.meta?.templateId;
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || (row.meta.version ?? 0) > (existing.meta.version ?? 0)) {
      byId.set(id, row);
    }
  }
  return [...byId.values()];
}

function conditionsOf(meta: TemplateMeta): string[] {
  const out = new Set<string>();
  const single = firstString(meta.condition);
  if (single) out.add(single);
  for (const value of [meta.condition, meta.conditions, meta.category]) {
    if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string' && v.trim()) out.add(v.trim());
    }
  }
  return [...out];
}

function eqCi(a: string | undefined, b: string): boolean {
  return typeof a === 'string' && a.trim().toUpperCase() === b.trim().toUpperCase();
}

function arrayHasCi(values: unknown, needle: string): boolean {
  if (!Array.isArray(values)) return false;
  return values.some((v) => typeof v === 'string' && v.trim().toUpperCase() === needle.trim().toUpperCase());
}

function matchesActiveFilters(meta: TemplateMeta, params: ListMasterTemplatesParams): boolean {
  if (params.status && (meta.status ?? TEMPLATE_STATUS.DRAFT) !== params.status) return false;
  if (params.shareScope && normalizeShareScope(meta.shareScope) !== params.shareScope) return false;

  const condition = params.conditionCode ?? params.condition;
  if (condition) {
    const hit =
      eqCi(firstString(meta.condition), condition) ||
      arrayHasCi(meta.conditions, condition) ||
      arrayHasCi(meta.condition as unknown, condition) ||
      eqCi(firstString(meta.category), condition);
    if (!hit) return false;
  }

  if (params.category && !eqCi(firstString(meta.category), params.category) && !arrayHasCi(meta.category as unknown, params.category)) {
    return false;
  }
  if (params.country && !arrayHasCi(meta.countries, params.country)) return false;
  if (params.language && !arrayHasCi(meta.languages, params.language)) return false;
  if (params.specialty && !arrayHasCi(meta.specialty, params.specialty)) return false;
  if (params.templateCode) {
    const code = firstString(meta.templateCode);
    if (!code || !code.toUpperCase().startsWith(params.templateCode.trim().toUpperCase())) return false;
  }
  return true;
}

function computeCounts(reps: TemplateDdbRecord[]): ListStatusCounts {
  const byStatus: Record<string, number> = {
    DRAFT: 0,
    SAVED: 0,
    IN_REVIEW: 0,
    PUBLISHED: 0,
    ARCHIVED: 0,
    DEPRECATED: 0,
  };
  let active = 0;
  for (const r of reps) {
    const status = (r.meta.status ?? TEMPLATE_STATUS.DRAFT) as string;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (r.meta.isActive ?? true) active += 1;
  }
  return {
    total: reps.length,
    active,
    draft: byStatus.DRAFT,
    saved: byStatus.SAVED,
    inReview: byStatus.IN_REVIEW,
    published: byStatus.PUBLISHED,
    archived: byStatus.ARCHIVED,
    deprecated: byStatus.DEPRECATED,
    byStatus,
  };
}

function buildFilterOptions(reps: TemplateDdbRecord[]): ListFilterOptions {
  const status = Object.values(TEMPLATE_STATUS).map((value) => ({
    label: STATUS_LABELS[value] ?? value,
    value,
  }));
  const scope = Object.values(SHARE_SCOPE).map((value) => ({
    label: SCOPE_LABELS[value] ?? value,
    value,
  }));

  const conditionMap = new Map<string, string>();
  for (const r of reps) {
    for (const c of conditionsOf(r.meta)) {
      conditionMap.set(c.toUpperCase(), c);
    }
  }
  const condition = [...conditionMap.entries()]
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { status, scope, condition };
}

function decodeOffsetToken(token: string | undefined): number {
  const decoded = decodeListCursor(token);
  const offset = decoded?.o;
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
}
import { TemplateMasterOpsService } from './template-master-ops.service';
import { CompatibleTemplatesService } from './compatible-templates.service';
import type { ListCompatibleTemplatesParams } from '../models/api/compatible-templates.types';
import type {
  SaveMasterTemplateParams,
  TransitionMasterStatusParams,
  UpdateMasterVersionParams,
} from '../models/api/master-version-ops.types';

export class TemplateService {
  private readonly repo = new TemplateRepository();
  private readonly masterOps = new TemplateMasterOpsService(this.repo);
  private readonly compatibleSvc = new CompatibleTemplatesService(this.repo);

  async createMasterTemplate(
    input: CreateMasterTemplateInput,
    actorUserId?: string,
  ): Promise<{ record: TemplateDdbRecord }> {
    try {
      const templateId = TemplateEntityBuilder.normalizeTemplateId(input.templateCode);
      const existing = await this.repo.getMasterMeta(templateId);
      if (existing) {
        const conflict = new Error('Master template already exists') as Error & {
          statusCode: number;
          code: string;
        };
        conflict.statusCode = 409;
        conflict.code = 'CONFLICT';
        throw conflict;
      }

      const record = await this.repo.createMasterTemplate({
        ...input,
        createdBy: input.createdBy ?? actorUserId,
      });
      return { record };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  /**
   * Dashboard list endpoint. Returns paginated items plus status counts and filter dropdown
   * options. Counts and dropdown options span the whole `templateType` scope (independent of the
   * status/condition/scope filters) so badges stay stable while the table is filtered.
   */
  async listMasterTemplates(params: ListMasterTemplatesParams): Promise<ListMasterTemplatesResult> {
    try {
      const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIST_LIMIT));

      // Base scope = templateType only, across all statuses, one representative row per template.
      const allRows = await this.repo.listAllMasterVersionsAcrossStatuses({
        templateType: params.templateType,
      });
      const reps = representativePerTemplate(allRows);
      const historyByTemplateId = buildHistoryByTemplateId(allRows);

      const counts = computeCounts(reps);
      const filterOptions = buildFilterOptions(reps);

      const filtered = reps
        .filter((row) => matchesActiveFilters(row.meta, params))
        .sort((a, b) => {
          const aTs = Date.parse(a.meta.lastModifiedAt ?? '') || 0;
          const bTs = Date.parse(b.meta.lastModifiedAt ?? '') || 0;
          return bTs - aTs;
        });

      const total = filtered.length;
      const offset = decodeOffsetToken(params.nextToken);
      const page = filtered.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < total;

      return {
        items: page.map((row) => {
          const item = toMasterListItem(row);
          return {
            ...item,
            history: historyByTemplateId.get(row.meta.templateId) ?? [],
          };
        }),
        pagination: {
          limit,
          count: page.length,
          total,
          nextToken: hasMore ? encodeListCursor({ o: nextOffset }) : undefined,
          hasMore,
        },
        counts,
        filterOptions,
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async getMasterTemplateVersions(params: GetMasterVersionsParams): Promise<GetMasterVersionsResult> {
    try {
      const meta = await this.repo.getMasterMeta(params.templateId);
      if (!meta) {
        templateNotFoundError();
      }

      const versionQuery = params.version?.trim();
      if (!versionQuery) {
        const { items, lastEvaluatedKey } = await this.repo.listMasterVersions(params);
        const allVersions = await this.repo.queryMasterVersionsPage(params.templateId, { limit: 100 });
        return {
          mode: 'list',
          items: items.map(toVersionSummary),
          history: buildVersionHistory(allVersions.items),
          nextToken: listMasterNextToken(lastEvaluatedKey),
        };
      }

      if (versionQuery.toLowerCase() === 'latest') {
        const record = await this.resolveLatestMasterVersion(
          params.templateId,
          meta.meta,
          params.resolve ?? 'ACTIVE',
        );
        if (!record) {
          templateNotFoundError('Master template version not found');
        }
        return { mode: 'single', record };
      }

      const versionSk = normalizeVersionToSk(versionQuery);
      const record = await this.repo.getMasterVersion(params.templateId, versionSk);
      if (!record) {
        templateNotFoundError('Master template version not found');
      }
      return { mode: 'single', record };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async resolveLatestMasterVersion(
    templateId: string,
    meta: TemplateMeta,
    resolve: VersionResolveStrategy,
  ): Promise<TemplateDdbRecord | null> {
    if (resolve === 'ACTIVE') {
      const sk = templateVersionIdToSk(meta.templateVersionId);
      if (sk) {
        const active = await this.repo.getMasterVersion(templateId, sk);
        if (active) return active;
      }
    }

    const { items } = await this.repo.queryMasterVersionsPage(templateId, { limit: 100 });
    if (items.length === 0) return null;

    if (resolve === 'LATEST_PUBLISHED') {
      const published = items.filter((r) => r.meta?.status === TEMPLATE_STATUS.PUBLISHED);
      return pickHighestVersionRow(published.length ? published : items);
    }

    return pickHighestVersionRow(items);
  }

  async updateMasterTemplateVersion(params: UpdateMasterVersionParams) {
    return this.masterOps.updateMasterTemplateVersion(params);
  }

  async transitionMasterTemplateStatus(params: TransitionMasterStatusParams) {
    return this.masterOps.transitionMasterTemplateStatus(params);
  }

  /**
   * Single master write API: optional `lifecycleAction` (PUBLISH, SUBMIT_REVIEW, …) or content update.
   * Resolves the current head `templateVersionId` — clients do not pass version in the URL.
   */
  async saveMasterTemplate(params: SaveMasterTemplateParams): Promise<TemplateDdbRecord> {
    try {
      const metaRow = await this.repo.getMasterMeta(params.templateId);
      if (!metaRow) {
        templateNotFoundError();
      }

      const versionId =
        params.templateVersionId?.trim() || metaRow.meta.templateVersionId;
      if (!versionId?.trim()) {
        templateNotFoundError('Master template version not found');
      }

      const lifecycleAction =
        typeof params.body.lifecycleAction === 'string'
          ? params.body.lifecycleAction.trim()
          : typeof params.body.action === 'string'
            ? params.body.action.trim()
            : '';

      if (lifecycleAction) {
        return await this.transitionMasterTemplateStatus({
          templateId: params.templateId,
          versionId,
          body: {
            action: lifecycleAction,
            comment:
              typeof params.body.comment === 'string' ? params.body.comment : null,
            reason:
              typeof params.body.reason === 'string' ? params.body.reason : null,
          },
          actorUserId: params.actorUserId,
        });
      }

      return await this.updateMasterTemplateVersion({
        templateId: params.templateId,
        versionId,
        body: params.body,
        actorUserId: params.actorUserId,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listCompatibleTemplates(params: ListCompatibleTemplatesParams) {
    return this.compatibleSvc.listCompatibleTemplates(params);
  }

  toCreateResponse(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
