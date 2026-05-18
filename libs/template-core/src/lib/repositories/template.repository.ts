import { BaseRepository } from '@api-hub/utils';

import { TemplateEntityBuilder, type CreateMasterTemplateInput } from '../builder/template-entity.builder';
import { TemplateKeyBuilder } from '../builder/template-key.builder';
import {
  GSI2_TYPE_CATALOG,
  GSI4_TEMPLATE_CODE,
  GSI5_MASTER_STATUS,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  TEMPLATE_TYPE_CARE_PLAN,
  type TemplateStatus,
} from '../constants/template.constants';
import type { ListMasterTemplatesParams } from '../models/api/list-master.types';
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
): void {
  if (filters.category?.trim()) {
    eav[':category'] = filters.category.trim();
    filterParts.push(
      '(meta.category = :category OR contains(meta.category, :category) OR contains(meta.conditions, :category))',
    );
  }
  if (filters.condition?.trim()) {
    eav[':condition'] = filters.condition.trim();
    filterParts.push(
      '(meta.condition = :condition OR contains(meta.conditions, :condition))',
    );
  }
  if (filters.country?.trim()) {
    eav[':country'] = filters.country.trim();
    filterParts.push('contains(meta.countries, :country)');
  }
  if (filters.language?.trim()) {
    eav[':language'] = filters.language.trim();
    filterParts.push('contains(meta.languages, :language)');
  }
  if (filters.specialty?.trim()) {
    eav[':specialty'] = filters.specialty.trim();
    filterParts.push('contains(meta.specialty, :specialty)');
  }
  if (filters.templateCode?.trim()) {
    eav[':templateCode'] = filters.templateCode.trim();
    filterParts.push('(meta.templateCode = :templateCode OR begins_with(meta.templateCode, :templateCode))');
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
    appendListFilters(eav, filterParts, opts);

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      IndexName: GSI2_TYPE_CATALOG,
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: eav,
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
      ...(filterParts.length ? { FilterExpression: filterParts.join(' AND ') } : {}),
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
    appendListFilters(eav, filterParts, opts);

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      IndexName: GSI5_MASTER_STATUS,
      KeyConditionExpression: 'gsi5pk = :pk',
      ExpressionAttributeValues: eav,
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(opts.exclusiveStartKey ? { ExclusiveStartKey: opts.exclusiveStartKey } : {}),
      ...(filterParts.length ? { FilterExpression: filterParts.join(' AND ') } : {}),
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

    const deduped = dedupeByTemplateId(page.items);
    return { items: deduped, lastEvaluatedKey: page.lastEvaluatedKey };
  }
}

function dedupeByTemplateId(items: TemplateDdbRecord[]): TemplateDdbRecord[] {
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
