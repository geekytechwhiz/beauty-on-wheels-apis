import { BaseRepository } from '@api-hub/utils';

import { TemplateKeyBuilder } from '../builder/template-key.builder';
import {
  GSI1_ORG_INDEX,
  GSI1_ORG_TMPL_SK_PREFIX,
  TEMPLATE_META_SK,
  TEMPLATE_TYPE_CARE_PLAN,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { ListOrgTemplatesParams } from '../models/api/org-template.types';
import type { GetOrgVersionsParams } from '../models/api/org-template.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { assertTemplateTable, decodeListCursor, encodeListCursor } from '../utils/template.utils';

export class OrgTemplateRepository extends BaseRepository {
  async getOrgMeta(organizationId: string, templateId: string): Promise<TemplateDdbRecord | null> {
    const table = assertTemplateTable();
    return this.get<TemplateDdbRecord>(table, {
      pk: TemplateKeyBuilder.toOrgPk(organizationId, templateId),
      sk: TEMPLATE_META_SK,
    });
  }

  async getOrgVersion(
    organizationId: string,
    templateId: string,
    versionSk: string,
  ): Promise<TemplateDdbRecord | null> {
    const table = assertTemplateTable();
    return this.get<TemplateDdbRecord>(table, {
      pk: TemplateKeyBuilder.toOrgPk(organizationId, templateId),
      sk: TemplateKeyBuilder.toVersionSk(versionSk),
    });
  }

  async queryOrgVersionsPage(
    organizationId: string,
    templateId: string,
    opts: {
      limit: number;
      exclusiveStartKey?: Record<string, unknown>;
      status?: TemplateStatus;
    },
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTemplateTable();
    const pk = TemplateKeyBuilder.toOrgPk(organizationId, templateId);
    const eav: Record<string, unknown> = {
      ':pk': pk,
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

  async listOrgVersions(
    params: Pick<GetOrgVersionsParams, 'organizationId' | 'templateId' | 'status' | 'nextToken' | 'limit'>,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const exclusiveStartKey = decodeListCursor(params.nextToken);
    return this.queryOrgVersionsPage(params.organizationId, params.templateId, {
      limit,
      exclusiveStartKey,
      status: params.status,
    });
  }

  async createOrgTemplate(metaRow: TemplateDdbRecord, versionRow: TemplateDdbRecord): Promise<void> {
    const table = assertTemplateTable();
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
  }

  async queryOrgTemplatesGsi1Page(
    params: ListOrgTemplatesParams,
    opts: {
      limit: number;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTemplateTable();
    const templateType = params.templateType?.trim() || TEMPLATE_TYPE_CARE_PLAN;
    const eav: Record<string, unknown> = {
      ':pk': TemplateKeyBuilder.buildGsi1OrgPk(params.organizationId),
      ':skPrefix': `${GSI1_ORG_TMPL_SK_PREFIX}${templateType}#`,
    };
    const filterParts: string[] = [];

    if (params.status) {
      eav[':status'] = params.status;
      filterParts.push('meta.#status = :status');
    }
    if (params.condition?.trim()) {
      eav[':condition'] = params.condition.trim();
      filterParts.push(
        '(meta.condition = :condition OR contains(meta.conditions, :condition))',
      );
    }
    if (params.specialty?.trim()) {
      eav[':specialty'] = params.specialty.trim();
      filterParts.push('contains(meta.specialty, :specialty)');
    }

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      IndexName: GSI1_ORG_INDEX,
      KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :skPrefix)',
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

  async listOrgTemplates(
    params: ListOrgTemplatesParams,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const exclusiveStartKey = decodeListCursor(params.nextToken);
    const page = await this.queryOrgTemplatesGsi1Page(params, { limit, exclusiveStartKey });

    const seen = new Map<string, TemplateDdbRecord>();
    for (const item of page.items) {
      const id = item.meta?.templateId;
      if (!id) continue;
      if (!seen.has(id)) {
        seen.set(id, item);
      }
    }

    return { items: [...seen.values()], lastEvaluatedKey: page.lastEvaluatedKey };
  }
}

export function listOrgNextToken(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  return encodeListCursor(lastEvaluatedKey);
}
