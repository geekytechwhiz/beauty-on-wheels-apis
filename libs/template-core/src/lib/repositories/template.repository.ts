import { BaseRepository } from '@api-hub/utils';

import { TemplateEntityBuilder, type CreateMasterTemplateInput } from '../builder/template-entity.builder';
import { TemplateKeyBuilder } from '../builder/template-key.builder';
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  GSI2_TYPE_CATALOG,
  GSI5_MASTER_STATUS,
  MASTER_CATALOG_TEMPLATE_TYPES,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { ListMasterTemplatesParams } from '../models/api/list-master.types';
import type { ListMasterVersionsParams } from '../models/api/get-master-versions.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { appendVersionHistoryToRecord } from '../mappers/template-http.dto';
import { assertTemplateTable, decodeListCursor, encodeListCursor } from '../utils/template.utils';

export type MasterListFilters = Pick<
  ListMasterTemplatesParams,
  'category' | 'condition' | 'country' | 'language' | 'specialty' | 'templateCode' | 'templateType'
>;

function appendListFilters(
  eav: Record<string, unknown>,
  filterParts: string[],
  filters: MasterListFilters,
  names: Record<string, string>,
): void {
  names['#meta'] = 'meta';

  if (filters.category?.trim()) {
    eav[':category'] = filters.category.trim();
    names['#category'] = 'category';
    names['#conditions'] = 'conditions';
    filterParts.push(
      '(#meta.#category = :category OR contains(#meta.#category, :category) OR contains(#meta.#conditions, :category))',
    );
  }
  if (filters.condition?.trim()) {
    eav[':condition'] = filters.condition.trim();
    names['#condition'] = 'condition';
    names['#conditions'] = 'conditions';
    filterParts.push(
      '(#meta.#condition = :condition OR contains(#meta.#conditions, :condition))',
    );
  }
  if (filters.country?.trim()) {
    eav[':country'] = filters.country.trim();
    names['#countries'] = 'countries';
    filterParts.push('contains(#meta.#countries, :country)');
  }
  if (filters.language?.trim()) {
    const lang = filters.language.trim();
    eav[':language'] = lang;
    eav[':languageLower'] = lang.toLowerCase();
    eav[':languageUpper'] = lang.toUpperCase();
    names['#languages'] = 'languages';
    filterParts.push(
      '(contains(#meta.#languages, :language) OR contains(#meta.#languages, :languageLower) OR contains(#meta.#languages, :languageUpper))',
    );
  }
  if (filters.specialty?.trim()) {
    eav[':specialty'] = filters.specialty.trim();
    names['#specialty'] = 'specialty';
    filterParts.push('contains(#meta.#specialty, :specialty)');
  }
  if (filters.templateCode?.trim()) {
    eav[':templateCode'] = filters.templateCode.trim();
    names['#templateCode'] = 'templateCode';
    filterParts.push(
      '(#meta.#templateCode = :templateCode OR begins_with(#meta.#templateCode, :templateCode))',
    );
  }
  if (filters.templateType?.trim()) {
    const normalized = filters.templateType.trim().replace(/\s+/g, '_').toUpperCase();
    eav[':templateType'] = normalized;
    names['#templateType'] = 'templateType';
    filterParts.push('#meta.#templateType = :templateType');
  }
}

export class TemplateRepository extends BaseRepository {
  private async listMasterTemplatesAcrossStatuses(
    filters: MasterListFilters,
    limit: number,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const statuses = [
      ...new Set([
        ...Object.values(TEMPLATE_STATUS),
        // Backward-compatible aliases for older rows that were written before
        // status normalization/gsi5 consistency.
        'Draft',
        'Saved',
        'InReview',
        'Published',
        'Archived',
        'Deprecated',
      ]),
    ] as TemplateStatus[];
    const pages = await Promise.all(
      statuses.map((status) =>
        this.queryMasterByStatusGsi5Page(status, {
          limit,
          ...filters,
        }),
      ),
    );

    const combined = keepOneListItemPerMasterTemplate(pages.flatMap((p) => p.items));
    combined.sort((a, b) => {
      const aTs = Date.parse(a.meta?.lastModifiedAt ?? '') || 0;
      const bTs = Date.parse(b.meta?.lastModifiedAt ?? '') || 0;
      return bTs - aTs;
    });

    return { items: combined.slice(0, limit) };
  }

  /**
   * Fetch every master VERSION row matching the base filters across all lifecycle statuses.
   * Used by the dashboard list endpoint to compute counts, filter options, and in-app pagination.
   * Bounded by `scanLimitPerStatus` per status partition to stay within reasonable RCUs.
   */
  async listAllMasterVersionsAcrossStatuses(
    filters: MasterListFilters = {},
    scanLimitPerStatus = 200,
  ): Promise<TemplateDdbRecord[]> {
    const statuses = [TEMPLATE_STATUS.DRAFT, TEMPLATE_STATUS.PUBLISHED] as TemplateStatus[];

    const pages = await Promise.all(
      statuses.map((status) =>
        this.queryMasterByStatusGsi5Page(status, { limit: scanLimitPerStatus, ...filters }),
      ),
    );

    const seen = new Set<string>();
    const rows: TemplateDdbRecord[] = [];
    for (const row of pages.flatMap((p) => p.items)) {
      if (!isMasterVersionSk(row.sk)) continue;
      const key = `${row.pk}#${row.sk}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }

  /**
   * Published master catalog only (GSI2). One representative VERSION row per templateId.
   * Used for org-enablement filterOptions and derive master picker.
   */
  async listPublishedMasterCatalogRows(
    opts: { templateType?: string; scanLimitPerType?: number } = {},
  ): Promise<TemplateDdbRecord[]> {
    const scanLimit = opts.scanLimitPerType ?? 200;
    const types = opts.templateType?.trim()
      ? [TemplateEntityBuilder.normalizeTemplateType(opts.templateType)]
      : [...MASTER_CATALOG_TEMPLATE_TYPES];

    const pages = await Promise.all(
      types.map((templateType) =>
        this.queryMasterCatalogGsi2Page(templateType, { limit: scanLimit }),
      ),
    );

    const rows = pages
      .flatMap((p) => p.items)
      .filter((row) => isMasterVersionSk(row.sk));
    return keepOneListItemPerMasterTemplate(rows);
  }

  async getMasterMeta(templateId: string): Promise<TemplateDdbRecord | null> {
    const table = assertTemplateTable();
    const pk = TemplateKeyBuilder.toMasterPk(templateId);
    const meta = await this.get<TemplateDdbRecord>(table, {
      pk,
      sk: TEMPLATE_META_SK,
    });
    if (meta) return meta;

    // Version-only masters (no META row): return the latest VERSION#* row.
    const { items } = await this.queryMasterVersionsPage(templateId, { limit: 1 });
    if (items[0]) return items[0];

    return this.getMasterVersion(templateId, `${VERSION_SK_PREFIX}001`);
  }

  async getMasterVersion(templateId: string, versionSk: string): Promise<TemplateDdbRecord | null> {
    const table = assertTemplateTable();
    return this.get<TemplateDdbRecord>(table, {
      pk: TemplateKeyBuilder.toMasterPk(templateId),
      sk: TemplateKeyBuilder.toVersionSk(versionSk),
    });
  }

  async queryMasterVersionsPage(
    templateId: string,
    opts: {
      limit: number;
      exclusiveStartKey?: Record<string, unknown>;
      status?: TemplateStatus;
    },
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTemplateTable();
    const eav: Record<string, unknown> = {
      ':pk': TemplateKeyBuilder.toMasterPk(templateId),
      ':skPrefix': VERSION_SK_PREFIX,
    };
    const filterParts: string[] = [];
    const names: Record<string, string> = {};
    if (opts.status) {
      eav[':status'] = opts.status;
      names['#meta'] = 'meta';
      names['#status'] = 'status';
      filterParts.push('#meta.#status = :status');
    }

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: eav,
      ...(filterParts.length
        ? {
            FilterExpression: filterParts.join(' AND '),
            ExpressionAttributeNames: names,
          }
        : {}),
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
    });
  }

  async listMasterVersions(
    params: ListMasterVersionsParams,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
    const exclusiveStartKey = decodeListCursor(params.nextToken);
    return this.queryMasterVersionsPage(params.templateId, {
      limit,
      exclusiveStartKey,
      status: params.status,
    });
  }

  async createMasterTemplate(input: CreateMasterTemplateInput): Promise<TemplateDdbRecord> {
    const table = assertTemplateTable();
    const ctx = TemplateEntityBuilder.buildCreateContext(input);
    const versionRow = TemplateEntityBuilder.buildVersionRow(ctx, input);
    appendVersionHistoryToRecord(versionRow, { isCreate: true });

    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: versionRow as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
      ],
    });

    return versionRow;
  }

  async saveMasterMetaAndVersion(
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    opts?: { requireNewVersionSk?: boolean },
  ): Promise<void> {
    const table = assertTemplateTable();
    const versionCondition = opts?.requireNewVersionSk
      ? 'attribute_not_exists(pk)'
      : undefined;

    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: metaRow as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_exists(pk)',
          },
        },
        {
          Put: {
            TableName: table,
            Item: versionRow as unknown as Record<string, unknown>,
            ...(versionCondition ? { ConditionExpression: versionCondition } : {}),
          },
        },
      ],
    });
  }

  async putMasterRecord(record: TemplateDdbRecord): Promise<void> {
    const table = assertTemplateTable();
    await this.put(table, record);
  }

  async queryMasterCatalogGsi2Page(
    templateType: string,
    opts: {
      limit: number;
      exclusiveStartKey?: Record<string, unknown>;
    } & MasterListFilters,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTemplateTable();
    const eav: Record<string, unknown> = {
      ':pk': TemplateKeyBuilder.buildGsi2Pk(templateType),
    };
    const filterParts: string[] = [];
    const names: Record<string, string> = {};
    appendListFilters(eav, filterParts, opts, names);

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      IndexName: GSI2_TYPE_CATALOG,
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: eav,
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
      ...(filterParts.length
        ? {
            FilterExpression: filterParts.join(' AND '),
            ExpressionAttributeNames: names,
          }
        : {}),
    });
  }

  async queryMasterByStatusGsi5Page(
    status: TemplateStatus,
    opts: {
      limit: number;
      exclusiveStartKey?: Record<string, unknown>;
    } & MasterListFilters,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTemplateTable();
    const eav: Record<string, unknown> = {
      ':pk': TemplateKeyBuilder.buildGsi5Pk(status),
    };
    const filterParts: string[] = [];
    const names: Record<string, string> = {};
    appendListFilters(eav, filterParts, opts, names);

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      IndexName: GSI5_MASTER_STATUS,
      KeyConditionExpression: 'gsi5pk = :pk',
      ExpressionAttributeValues: eav,
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
      ...(filterParts.length
        ? {
            FilterExpression: filterParts.join(' AND '),
            ExpressionAttributeNames: names,
          }
        : {}),
    });
  }

  async listMasterTemplates(params: ListMasterTemplatesParams): Promise<{
    items: TemplateDdbRecord[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
    const exclusiveStartKey = decodeListCursor(params.nextToken);
    const templateType = params.templateType?.trim();
    const filters: MasterListFilters = {
      category: params.category,
      condition: params.condition,
      country: params.country,
      language: params.language,
      specialty: params.specialty,
      templateCode: params.templateCode,
      templateType,
    };

    const status = params.status;
    const hasAnyFilter =
      !!templateType ||
      !!status ||
      !!params.category?.trim() ||
      !!params.condition?.trim() ||
      !!params.country?.trim() ||
      !!params.language?.trim() ||
      !!params.specialty?.trim() ||
      !!params.templateCode?.trim();

    // Empty query should list all templates across statuses.
    if (!hasAnyFilter && !exclusiveStartKey) {
      return this.listMasterTemplatesAcrossStatuses(filters, limit);
    }

    // templateType without status must include DRAFT/SAVED rows (GSI2 is published-only).
    if (templateType && !status) {
      return this.listMasterTemplatesAcrossStatuses(filters, limit);
    }

    // Published catalog by type only (all published TASK templates, etc.).
    const shouldUseGsi2 =
      status === TEMPLATE_STATUS.PUBLISHED && !!templateType && !params.category?.trim();

    const page = shouldUseGsi2
      ? await this.queryMasterCatalogGsi2Page(templateType!, {
          limit,
          exclusiveStartKey,
          ...filters,
        })
      : await this.queryMasterByStatusGsi5Page(status ?? TEMPLATE_STATUS.PUBLISHED, {
          limit,
          exclusiveStartKey,
          ...filters,
        });

    const items = keepOneListItemPerMasterTemplate(page.items);
    return { items, lastEvaluatedKey: page.lastEvaluatedKey };
  }
}

/**
 * GSI2 (published catalog) and GSI5 (status queue) can return multiple VERSION rows
 * for the same master templateId. The list API exposes one row per template — keep the
 * first item encountered per templateId (query order is newest-first via ScanIndexForward).
 */
function isMasterVersionSk(sk: string | undefined): boolean {
  return typeof sk === 'string' && sk.startsWith(VERSION_SK_PREFIX);
}

function keepOneListItemPerMasterTemplate(items: TemplateDdbRecord[]): TemplateDdbRecord[] {
  const seen = new Map<string, TemplateDdbRecord>();
  for (const item of items) {
    const id = item.meta?.templateId;
    if (!id) continue;
    const existing = seen.get(id);
    if (!existing) {
      seen.set(id, item);
      continue;
    }
    if (isMasterVersionSk(item.sk) && !isMasterVersionSk(existing.sk)) {
      seen.set(id, item);
    }
  }
  return [...seen.values()].filter((row) => isMasterVersionSk(row.sk));
}

export function listMasterNextToken(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  return encodeListCursor(lastEvaluatedKey);
}
