import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { TemplateMetadata } from '../types';
import type { TemplateMetadataStore } from '../template-metadata-store.port';
import { ENTITY_TYPE, gsi1Pk, gsi1Sk, orgPk, templateVersionSk } from './keys';

export type TemplateDdbItem = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: typeof ENTITY_TYPE;
  templateId: string;
  orgId: string;
  version: string;
  type: string;
  status: string;
  baseTemplateId?: string;
  baseVersion?: string;
  baseOrgId?: string;
  schemaRef: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  /** Legacy only */
  extendsTemplateId?: string;
  extendsVersion?: string;
  config?: unknown;
  rules?: unknown;
  actions?: unknown;
};

function stripDdbKeys(item: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...item };
  delete rest.pk;
  delete rest.sk;
  delete rest.gsi1pk;
  delete rest.gsi1sk;
  delete rest.entityType;
  return rest;
}

function isLegacyShape(rest: Record<string, unknown>): boolean {
  if ('config' in rest || 'rules' in rest || 'actions' in rest) return true;
  const ref = rest.schemaRef;
  return typeof ref !== 'string' || ref.trim() === '';
}

function toItem(m: TemplateMetadata): TemplateDdbItem {
  return {
    pk: orgPk(m.orgId),
    sk: templateVersionSk(m.templateId, m.version),
    gsi1pk: gsi1Pk(m.orgId, m.templateId),
    gsi1sk: gsi1Sk(m.version),
    entityType: ENTITY_TYPE,
    templateId: m.templateId,
    orgId: m.orgId,
    version: m.version,
    type: m.type,
    status: m.status,
    baseTemplateId: m.baseTemplateId,
    baseVersion: m.baseVersion,
    baseOrgId: m.baseOrgId,
    schemaRef: m.schemaRef,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    createdBy: m.createdBy,
  };
}

function fromItem(item: Record<string, unknown>): TemplateMetadata {
  const rest = stripDdbKeys(item) as Record<string, unknown>;
  const baseTemplateId =
    (rest.baseTemplateId as string | undefined) ||
    (rest.extendsTemplateId as string | undefined);
  const baseVersion =
    (rest.baseVersion as string | undefined) || (rest.extendsVersion as string | undefined);

  const type = (rest.type as TemplateMetadata['type']) ?? 'ORG';
  const status = (rest.status as TemplateMetadata['status']) ?? 'draft';

  if (isLegacyShape(rest)) {
    const config =
      rest.config && typeof rest.config === 'object' && !Array.isArray(rest.config)
        ? (rest.config as Record<string, unknown>)
        : {};
    return {
      templateId: String(rest.templateId ?? ''),
      orgId: String(rest.orgId ?? ''),
      version: String(rest.version ?? ''),
      type,
      status,
      baseTemplateId,
      baseVersion,
      baseOrgId: rest.baseOrgId as string | undefined,
      schemaRef: typeof rest.schemaRef === 'string' ? rest.schemaRef : '',
      createdAt: String(rest.createdAt ?? ''),
      updatedAt: String(rest.updatedAt ?? ''),
      createdBy: rest.createdBy as string | undefined,
      legacyInlineDocument: {
        config,
        rules: 'rules' in rest ? rest.rules : {},
        actions: 'actions' in rest ? rest.actions : [],
      },
    };
  }

  return {
    templateId: String(rest.templateId ?? ''),
    orgId: String(rest.orgId ?? ''),
    version: String(rest.version ?? ''),
    type,
    status,
    baseTemplateId,
    baseVersion,
    baseOrgId: rest.baseOrgId as string | undefined,
    schemaRef: String(rest.schemaRef ?? ''),
    createdAt: String(rest.createdAt ?? ''),
    updatedAt: String(rest.updatedAt ?? ''),
    createdBy: rest.createdBy as string | undefined,
  };
}

export class TemplateDdbRepository implements TemplateMetadataStore {
  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    if (!tableName) {
      throw new Error('TEMPLATE_TABLE is not configured');
    }
  }

  async getByKey(orgId: string, templateId: string, version: string): Promise<TemplateMetadata | null> {
    const res = (await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: orgPk(orgId),
          sk: templateVersionSk(templateId, version),
        },
      }) as never,
    )) as { Item?: Record<string, unknown> };
    if (!res.Item) return null;
    return fromItem(res.Item);
  }

  async listVersionsForTemplate(orgId: string, templateId: string): Promise<TemplateMetadata[]> {
    const res = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :gpk',
        ExpressionAttributeValues: {
          ':gpk': gsi1Pk(orgId, templateId),
        },
      }) as never,
    )) as { Items?: Record<string, unknown>[] };
    const items = res.Items ?? [];
    return items.map((i: Record<string, unknown>) => fromItem(i));
  }

  async putMetadata(template: TemplateMetadata): Promise<void> {
    const meta = { ...template };
    delete (meta as { legacyInlineDocument?: unknown }).legacyInlineDocument;
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toItem(meta as TemplateMetadata),
      }) as never,
    );
  }
}
