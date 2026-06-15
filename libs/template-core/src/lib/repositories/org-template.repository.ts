import { BaseRepository } from '@api-hub/utils';

import { TemplateKeyBuilder } from '../builder/template-key.builder';
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  GSI1_ORG_INDEX,
  GSI1_ORG_TMPL_SK_PREFIX,
  TEMPLATE_META_SK,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { ListOrgTemplatesParams } from '../models/api/org-template.types';
import type { GetOrgVersionsParams } from '../models/api/org-template.types';
import type { TemplateDdbRecord, TemplateMeta } from '../models/persistence/template-ddb.model';
import {
  assertTemplateTable,
  decodeListCursor,
  encodeListCursor,
  resolveOrgVersionPointerSk,
} from '../utils/template.utils';

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

  /** Resolve VERSION row from META pointer; falls back to newest VERSION row under the org template. */
  async getOrgVersionForMeta(
    organizationId: string,
    templateId: string,
    meta: Pick<TemplateMeta, 'templateVersionId' | 'version'>,
  ): Promise<TemplateDdbRecord | null> {
    const pointerSk = resolveOrgVersionPointerSk(meta);
    const candidateSks = new Set([
      pointerSk,
      `${VERSION_SK_PREFIX}001`,
      TemplateKeyBuilder.toVersionSk('001'),
    ]);

    for (const versionSk of candidateSks) {
      const versionRow = await this.getOrgVersion(organizationId, templateId, versionSk);
      if (versionRow) return versionRow;
    }

    const { items } = await this.queryOrgVersionsPage(organizationId, templateId, { limit: 10 });
    return items[0] ?? null;
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

  async listOrgVersions(
    params: Pick<GetOrgVersionsParams, 'organizationId' | 'templateId' | 'status' | 'nextToken'>,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
    const exclusiveStartKey = decodeListCursor(params.nextToken);
    return this.queryOrgVersionsPage(params.organizationId, params.templateId, {
      limit,
      exclusiveStartKey,
      status: params.status,
    });
  }

  async saveOrgMetaAndVersion(
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
    const templateType = params.templateType?.trim();
    const eav: Record<string, unknown> = {
      ':pk': TemplateKeyBuilder.buildGsi1OrgPk(params.organizationId),
      ':skPrefix': templateType
        ? `${GSI1_ORG_TMPL_SK_PREFIX}${templateType}#`
        : GSI1_ORG_TMPL_SK_PREFIX,
    };
    const filterParts: string[] = [];
    const names: Record<string, string> = { '#meta': 'meta' };

    if (params.status) {
      eav[':status'] = params.status;
      names['#status'] = 'status';
      filterParts.push('#meta.#status = :status');
    }
    if (params.condition?.trim()) {
      eav[':condition'] = params.condition.trim();
      names['#condition'] = 'condition';
      names['#conditions'] = 'conditions';
      filterParts.push(
        '(#meta.#condition = :condition OR contains(#meta.#conditions, :condition))',
      );
    }
    if (params.specialty?.trim()) {
      eav[':specialty'] = params.specialty.trim();
      names['#specialty'] = 'specialty';
      filterParts.push('contains(#meta.#specialty, :specialty)');
    }

    return this.queryPage<TemplateDdbRecord>({
      TableName: table,
      IndexName: GSI1_ORG_INDEX,
      KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :skPrefix)',
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

  async listOrgTemplates(
    params: ListOrgTemplatesParams,
  ): Promise<{ items: TemplateDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
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
