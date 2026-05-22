import { BaseRepository } from '@api-hub/utils';

import { TemplateEntityBuilder, type CreateMasterTemplateInput } from '../builder/template-entity.builder';
import { TemplateKeyBuilder } from '../builder/template-key.builder';
import {
  GSI2_TYPE_CATALOG,
  GSI5_MASTER_STATUS,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  TEMPLATE_TYPE_CARE_PLAN,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { ListMasterTemplatesParams } from '../models/api/list-master.types';
import type { ListMasterVersionsParams } from '../models/api/get-master-versions.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { assertTemplateTable, decodeListCursor, encodeListCursor } from '../utils/template.utils';

export type MasterListFilters = Pick<
  ListMasterTemplatesParams,
  'category' | 'condition' | 'country' | 'language' | 'specialty' | 'templateCode'
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
    // Only use contains on conditions list — equality on meta.condition fails when stored as a list.
    filterParts.push('contains(#meta.#conditions, :condition)');
  }
  if (filters.country?.trim()) {
    eav[':country'] = filters.country.trim();
    filterParts.push('contains(#meta.#countries, :country)');
  }
  if (filters.language?.trim()) {
    eav[':language'] = filters.language.trim();
    names['#languages'] = 'languages';
    filterParts.push('contains(#meta.#languages, :language)');
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
}

export class TemplateRepository extends BaseRepository {
  async getMasterMeta(templateId: string): Promise<TemplateDdbRecord | null> {
    const table = assertTemplateTable();
    return this.get<TemplateDdbRecord>(table, {
      pk: TemplateKeyBuilder.toMasterPk(templateId),
      sk: TEMPLATE_META_SK,
    });
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
    if (opts.status) {
      eav[':status'] = opts.status;
      filterParts.push('meta.#status = :status');
    }

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: eav,
      ...(filterParts.length
        ? {
            FilterExpression: filterParts.join(' AND '),
            ExpressionAttributeNames: { '#status': 'status' },
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
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
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
    const metaRow = TemplateEntityBuilder.buildMetaRow(ctx);
    const versionRow = TemplateEntityBuilder.buildVersionRow(ctx, input);

    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: metaRow as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
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
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const exclusiveStartKey = decodeListCursor(params.nextToken);
    const templateType = params.templateType?.trim() || TEMPLATE_TYPE_CARE_PLAN;
    const filters: MasterListFilters = {
      category: params.category,
      condition: params.condition,
      country: params.country,
      language: params.language,
      specialty: params.specialty,
      templateCode: params.templateCode,
    };

    const status = params.status;
    const useGsi2 =
      !status || status === TEMPLATE_STATUS.PUBLISHED;

    const page = useGsi2
      ? await this.queryMasterCatalogGsi2Page(templateType, {
          limit,
          exclusiveStartKey,
          ...filters,
        })
      : await this.queryMasterByStatusGsi5Page(status, {
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
function keepOneListItemPerMasterTemplate(items: TemplateDdbRecord[]): TemplateDdbRecord[] {
  const seen = new Map<string, TemplateDdbRecord>();
  for (const item of items) {
    const id = item.meta?.templateId;
    if (!id) continue;
    if (!seen.has(id)) {
      seen.set(id, item);
    }
  }
  return [...seen.values()];
}

export function listMasterNextToken(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  return encodeListCursor(lastEvaluatedKey);
}
