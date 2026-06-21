import {
  TemplateEntityBuilder,
  type CreateMasterTemplateInput,
} from '../builder/template-entity.builder';
import {
  buildVersionHistory,
  resolveTemplateHistory,
  toMasterFullRecord,
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
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  SHARE_SCOPE,
  TEMPLATE_STATUS,
} from '../constants/template.constants';
import {
  listMasterNextToken,
  TemplateRepository,
} from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { extractCatalogCodes } from '../utils/field-values-profile.utils';
import { normalizeShareScope } from '../utils/share-scope.utils';
import {
  decodeListCursor,
  encodeListCursor,
  firstString,
  resolveMasterTemplateIsActive,
  normalizeVersionToSk,
  pickHighestVersionRow,
  templateConflictError,
  templateNotFoundError,
  templateVersionIdToSk,
} from '../utils/template.utils';
import type { MasterTemplateListItem } from '../mappers/template-http.dto';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
};

const SCOPE_LABELS: Record<string, string> = {
  PRIVATE: 'Private',
  ORGANIZATION: 'Organization',
  PUBLIC: 'Public',
};

const DEFAULT_LIST_LIMIT = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;

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

function fieldValuesOf(record: TemplateDdbRecord): Record<string, unknown> {
  const fv = record.fieldValues;
  return fv && typeof fv === 'object' && !Array.isArray(fv) ? (fv as Record<string, unknown>) : {};
}

function matchesActiveFilters(record: TemplateDdbRecord, params: ListMasterTemplatesParams): boolean {
  const meta = record.meta;
  const fv = fieldValuesOf(record);
  const catalog = extractCatalogCodes(fv);

  if (params.status && (meta.status ?? TEMPLATE_STATUS.DRAFT) !== params.status) return false;

  if (params.shareScope) {
    const scope =
      normalizeShareScope(meta.shareScope) ??
      normalizeShareScope(catalog.shareScope) ??
      normalizeShareScope(firstString(fv.shareScope));
    if (scope !== params.shareScope) return false;
  }

  const condition = params.conditionCode ?? params.condition;
  if (condition) {
    const hit =
      eqCi(catalog.conditionCode, condition) ||
      eqCi(firstString(meta.condition), condition) ||
      arrayHasCi(meta.conditions, condition) ||
      arrayHasCi(meta.condition as unknown, condition) ||
      eqCi(catalog.categoryCode, condition) ||
      eqCi(firstString(meta.category), condition);
    if (!hit) return false;
  }

  const categoryFilter = params.categoryCode ?? params.category;
  if (
    categoryFilter &&
    !eqCi(catalog.categoryCode, categoryFilter) &&
    !eqCi(firstString(meta.category), categoryFilter) &&
    !arrayHasCi(meta.category as unknown, categoryFilter)
  ) {
    return false;
  }
  if (params.country && !arrayHasCi(meta.countries, params.country)) return false;
  if (params.language && !arrayHasCi(meta.languages, params.language)) return false;
  if (params.specialty && !arrayHasCi(meta.specialty, params.specialty)) return false;
  if (params.templateCode) {
    const code = firstString(meta.templateCode);
    if (!code || !code.toUpperCase().startsWith(params.templateCode.trim().toUpperCase())) return false;
  }

  const nameFilter = params.templateName?.trim();
  if (nameFilter) {
    const byId = eqCi(meta.templateId, nameFilter);
    const displayName = meta.templateName?.trim() ?? '';
    const byName = displayName.toLowerCase().includes(nameFilter.toLowerCase());
    if (!byId && !byName) return false;
  }

  if (params.active !== undefined && resolveMasterTemplateIsActive(meta) !== params.active) {
    return false;
  }

  return true;
}

/** Dashboard counts: `active`/`inactive` from `isActive` (published may be inactive); `draft`/`published` by status. */
function computeCounts(reps: TemplateDdbRecord[]): ListStatusCounts {
  let active = 0;
  let inactive = 0;
  let draft = 0;
  let published = 0;
  for (const r of reps) {
    const status = (r.meta.status ?? TEMPLATE_STATUS.DRAFT) as string;
    if (resolveMasterTemplateIsActive(r.meta)) {
      active += 1;
    } else {
      inactive += 1;
    }
    if (status === TEMPLATE_STATUS.DRAFT) draft += 1;
    if (status === TEMPLATE_STATUS.PUBLISHED) published += 1;
  }
  return {
    total: reps.length,
    active,
    inactive,
    draft,
    published,
  };
}

function buildFilterOptions(reps: TemplateDdbRecord[]): ListFilterOptions {
  const status = [TEMPLATE_STATUS.DRAFT, TEMPLATE_STATUS.PUBLISHED].map((value) => ({
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
    actorUser?: import('../models/template-actor.model').TemplateActorUser,
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
        actor: input.actor ?? actorUser,
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
      const limit = DEFAULT_LIST_LIMIT;

      // Base scope = templateType only, across all statuses, one representative row per template.
      const allRows = await this.repo.listAllMasterVersionsAcrossStatuses({
        templateType: params.templateType,
      });
      const reps = representativePerTemplate(allRows);
      const versionsByTemplateId = new Map<string, TemplateDdbRecord[]>();
      for (const row of allRows) {
        const id = row.meta?.templateId;
        if (!id) continue;
        const list = versionsByTemplateId.get(id) ?? [];
        list.push(row);
        versionsByTemplateId.set(id, list);
      }

      const counts = computeCounts(reps);
      const filterOptions = buildFilterOptions(reps);

      const filtered = reps
        .filter((row) => matchesActiveFilters(row, params))
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
            history: resolveTemplateHistory(
              row,
              versionsByTemplateId.get(row.meta.templateId) ?? [],
            ),
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

  /**
   * All published master representatives (for org-enable dropdown options).
   * Independent of list table filters so empty pages still expose full filterOptions.
   */
  async listPublishedMasterCatalogItems(templateType?: string) {
    try {
      const rows = await this.repo.listPublishedMasterCatalogRows(
        templateType?.trim() ? { templateType: templateType.trim() } : {},
      );
      return rows
        .filter((row) => row.meta?.status === TEMPLATE_STATUS.PUBLISHED)
        .map((row) => toMasterListItem(row));
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  /**
   * Resolves a published master from derive body `templateId` (catalog value or display name).
   */
  async resolvePublishedMasterForDerive(params: {
    templateIdOrName: string;
    templateType: string;
    categoryCode: string;
    conditionCode: string;
  }): Promise<{ templateId: string; templateVersionId: string }> {
    try {
      const raw = params.templateIdOrName.trim();
      const normalized = TemplateEntityBuilder.normalizeTemplateId(raw);
      const catalog = await this.listPublishedMasterCatalogItems(params.templateType.trim());

      const byId = (id: string) =>
        catalog.find(
          (item) =>
            item.templateId === id ||
            TemplateEntityBuilder.normalizeTemplateId(item.templateId) ===
              TemplateEntityBuilder.normalizeTemplateId(id),
        );

      const byName = () =>
        catalog.find(
          (item) => (item.templateName?.trim().toLowerCase() ?? '') === raw.toLowerCase(),
        );

      const hit =
        byId(raw) ??
        byId(normalized) ??
        byName() ??
        catalog.find((item) => item.templateVersionId === raw);

      if (!hit) {
        templateNotFoundError(
          'Published master template not found for templateId (check org catalog filterOptions)',
        );
      }

      this.assertDeriveMasterMatchesBody(hit, params);
      return {
        templateId: hit.templateId,
        templateVersionId: hit.templateVersionId,
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private assertDeriveMasterMatchesBody(
    item: MasterTemplateListItem,
    params: { templateType: string; categoryCode: string; conditionCode: string },
  ): void {
    const fv =
      item.fieldValues && typeof item.fieldValues === 'object' && !Array.isArray(item.fieldValues)
        ? (item.fieldValues as Record<string, unknown>)
        : {};
    const catalog = extractCatalogCodes(fv);
    const itemCategory = catalog.categoryCode;
    const itemCondition = catalog.conditionCode;
    const eq = (a: string | undefined, b: string) =>
      a?.trim().toUpperCase() === b.trim().toUpperCase();

    if (!eq(item.templateType, params.templateType)) {
      templateConflictError('templateType does not match the selected master template');
    }
    if (itemCategory && !eq(itemCategory, params.categoryCode)) {
      templateConflictError('categoryCode does not match the selected master template');
    }
    if (itemCondition && !eq(itemCondition, params.conditionCode)) {
      templateConflictError('conditionCode does not match the selected master template');
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
   * Master update: send `status` DRAFT or PUBLISHED (or PUBLISH) plus `fieldValues` — no lifecycle actions.
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

      return await this.updateMasterTemplateVersion({
        templateId: params.templateId,
        versionId,
        body: params.body,
        actorUser: params.actorUser,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listCompatibleTemplates(params: ListCompatibleTemplatesParams) {
    return this.compatibleSvc.listCompatibleTemplates(params);
  }

  /** Full VERSION document so create round-trips fieldValues and nested sections. */
  toCreateResponse(record: TemplateDdbRecord) {
    return toMasterFullRecord(record);
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
