import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import {
  TemplateVersionManager,
  type TemplateEvent,
  type TemplateMetadata,
  type TemplateOutboxEventRecord,
  type RuntimeTemplateBinding,
} from '../../domain';
import type {
  RuntimeBindingRepository,
  TemplateIdempotencyStore,
  TemplateOutboxStore,
  TemplateRepository,
} from '../../application';
import { normalizeTemplateStatus } from '../../domain/template-status';
import type { TemplateProfileDimensions } from '../../domain/template-profile';
import {
  ENTITY_TYPE,
  IDEMPOTENCY_ENTITY_TYPE,
  OUTBOX_ENTITY_TYPE,
  RUNTIME_BINDING_ENTITY_TYPE,
  gsi1Pk,
  gsi1Sk,
  gsi3Pk,
  gsi3SkPublished,
  idempotencyPk,
  idempotencySk,
  orgPk,
  outboxPk,
  outboxSk,
  outboxStatusPk,
  outboxStatusSk,
  runtimeBindingPk,
  runtimeBindingSk,
  templateVersionSk,
} from './keys';

export type TemplateDdbItem = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi3pk?: string;
  gsi3sk?: string;
  entityType: typeof ENTITY_TYPE;
  templateId: string;
  orgId: string;
  version: string;
  type: string;
  status: string;
  baseTemplateId?: string;
  baseVersion?: string;
  baseOrgId?: string;
  masterTemplateVersionId?: string;
  schemaRef: string;
  snapshotRef?: string;
  snapshotId?: string;
  profile?: TemplateProfileDimensions;
  profileKey?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  extendsTemplateId?: string;
  extendsVersion?: string;
  config?: unknown;
  rules?: unknown;
  actions?: unknown;
};

type TemplateOutboxDdbItem = {
  pk: string;
  sk: string;
  entityType: typeof OUTBOX_ENTITY_TYPE;
  gsi2pk: string;
  gsi2sk: string;
  status: 'PENDING' | 'SENT';
  payload: TemplateEvent;
  createdAt: string;
  sentAt?: string;
  ttl?: number;
};

type RuntimeBindingDdbItem = {
  pk: string;
  sk: string;
  entityType: typeof RUNTIME_BINDING_ENTITY_TYPE;
  patientId: string;
  templateId: string;
  version: string;
  orgId: string;
  createdAt: string;
};

type TemplateIdempotencyItem = {
  pk: string;
  sk: string;
  entityType: typeof IDEMPOTENCY_ENTITY_TYPE;
  result: unknown;
  createdAt: string;
  ttl?: number;
};

function stripDdbKeys(item: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...item };
  delete rest.pk;
  delete rest.sk;
  delete rest.gsi1pk;
  delete rest.gsi1sk;
  delete rest.gsi3pk;
  delete rest.gsi3sk;
  delete rest.gsi2pk;
  delete rest.gsi2sk;
  delete rest.entityType;
  return rest;
}

function isLegacyShape(rest: Record<string, unknown>): boolean {
  if ('config' in rest || 'rules' in rest || 'actions' in rest) return true;
  const schemaRef = rest.schemaRef;
  return typeof schemaRef !== 'string' || schemaRef.trim() === '';
}

function toItem(metadata: TemplateMetadata): TemplateDdbItem {
  const status = metadata.status;
  const canonical = normalizeTemplateStatus(String(status));
  let gsi3pk: string | undefined;
  let gsi3sk: string | undefined;
  if (canonical === 'PUBLISHED' && metadata.profileKey) {
    gsi3pk = gsi3Pk(metadata.profileKey);
    gsi3sk = gsi3SkPublished(metadata.templateId, metadata.version);
  }

  return {
    pk: orgPk(metadata.orgId),
    sk: templateVersionSk(metadata.templateId, metadata.version),
    gsi1pk: gsi1Pk(metadata.orgId, metadata.templateId),
    gsi1sk: gsi1Sk(metadata.version),
    ...(gsi3pk && gsi3sk ? { gsi3pk, gsi3sk } : {}),
    entityType: ENTITY_TYPE,
    templateId: metadata.templateId,
    orgId: metadata.orgId,
    version: metadata.version,
    type: metadata.type,
    status,
    baseTemplateId: metadata.baseTemplateId,
    baseVersion: metadata.baseVersion,
    baseOrgId: metadata.baseOrgId,
    masterTemplateVersionId: metadata.masterTemplateVersionId,
    schemaRef: metadata.schemaRef,
    snapshotRef: metadata.snapshotRef,
    snapshotId: metadata.snapshotId,
    profile: metadata.profile,
    profileKey: metadata.profileKey,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    createdBy: metadata.createdBy,
  };
}

function fromItem(item: Record<string, unknown>): TemplateMetadata {
  const rest = stripDdbKeys(item);
  const baseTemplateId =
    (rest.baseTemplateId as string | undefined) ||
    (rest.extendsTemplateId as string | undefined);
  const baseVersion =
    (rest.baseVersion as string | undefined) || (rest.extendsVersion as string | undefined);
  const type = (rest.type as TemplateMetadata['type']) ?? 'ORG';
  const status = normalizeTemplateStatus(rest.status as string | undefined);

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
      masterTemplateVersionId: rest.masterTemplateVersionId as string | undefined,
      schemaRef: typeof rest.schemaRef === 'string' ? rest.schemaRef : '',
      snapshotRef: rest.snapshotRef as string | undefined,
      snapshotId: rest.snapshotId as string | undefined,
      profile: rest.profile as TemplateProfileDimensions | undefined,
      profileKey: rest.profileKey as string | undefined,
      createdAt: String(rest.createdAt ?? ''),
      updatedAt: String(rest.updatedAt ?? ''),
      createdBy: rest.createdBy as string | undefined,
      legacyInlineDocument: {
        config,
          rules: Array.isArray(rest.rules) ? rest.rules : [],
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
    masterTemplateVersionId: rest.masterTemplateVersionId as string | undefined,
    schemaRef: String(rest.schemaRef ?? ''),
    snapshotRef: rest.snapshotRef as string | undefined,
    snapshotId: rest.snapshotId as string | undefined,
    profile: rest.profile as TemplateProfileDimensions | undefined,
    profileKey: rest.profileKey as string | undefined,
    createdAt: String(rest.createdAt ?? ''),
    updatedAt: String(rest.updatedAt ?? ''),
    createdBy: rest.createdBy as string | undefined,
  };
}

function toOutboxItem(event: TemplateEvent, eventId: string): TemplateOutboxDdbItem {
  return {
    pk: outboxPk(eventId),
    sk: outboxSk(),
    entityType: OUTBOX_ENTITY_TYPE,
    gsi2pk: outboxStatusPk('PENDING'),
    gsi2sk: outboxStatusSk(event.timestamp, eventId),
    status: 'PENDING',
    payload: event,
    createdAt: event.timestamp,
  };
}

function fromOutboxItem(item: Record<string, unknown>): TemplateOutboxEventRecord {
  return {
    eventId: String(item.pk ?? '').replace(/^EVENT#/, ''),
    payload: item.payload as TemplateEvent,
    status: (item.status as 'PENDING' | 'SENT') ?? 'PENDING',
    createdAt: String(item.createdAt ?? ''),
    sentAt: item.sentAt as string | undefined,
  };
}

function toRuntimeBindingItem(binding: RuntimeTemplateBinding): RuntimeBindingDdbItem {
  return {
    pk: runtimeBindingPk(binding.patientId),
    sk: runtimeBindingSk(binding.templateId),
    entityType: RUNTIME_BINDING_ENTITY_TYPE,
    patientId: binding.patientId,
    templateId: binding.templateId,
    version: binding.version,
    orgId: binding.orgId,
    createdAt: binding.createdAt,
  };
}

function toIdempotencyItem(idempotencyKey: string, result: unknown): TemplateIdempotencyItem {
  return {
    pk: idempotencyPk(idempotencyKey),
    sk: idempotencySk(),
    entityType: IDEMPOTENCY_ENTITY_TYPE,
    result,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  };
}

function fromRuntimeBindingItem(item: Record<string, unknown>): RuntimeTemplateBinding {
  return {
    patientId: String(item.patientId ?? ''),
    templateId: String(item.templateId ?? ''),
    version: String(item.version ?? ''),
    orgId: String(item.orgId ?? ''),
    createdAt: String(item.createdAt ?? ''),
  };
}

export class TemplateDdbRepository
  implements TemplateRepository, TemplateOutboxStore, RuntimeBindingRepository, TemplateIdempotencyStore
{
  private readonly versionManager = new TemplateVersionManager();

  constructor(private readonly docClient: DynamoDBDocumentClient, private readonly tableName: string) {
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

    return (res.Items ?? []).map((item) => fromItem(item));
  }

  async getLatestVersion(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    const versions = await this.listVersionsForTemplate(orgId, templateId);
    return this.versionManager.getLatestVersion(versions);
  }

  async getPublishedVersion(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    const versions = await this.listVersionsForTemplate(orgId, templateId);
    return this.versionManager.getPublishedVersion(versions);
  }

  async findPublishedByProfileKey(orgId: string, profileKey: string): Promise<TemplateMetadata | null> {
    if (!profileKey.startsWith(`${orgId}#`)) {
      return null;
    }
    const res = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI3',
        KeyConditionExpression: 'gsi3pk = :gpk AND begins_with(gsi3sk, :psk)',
        ExpressionAttributeValues: {
          ':gpk': gsi3Pk(profileKey),
          ':psk': 'PUBLISHED#',
        },
        Limit: 5,
      }) as never,
    )) as { Items?: Record<string, unknown>[] };

    const items = res.Items ?? [];
    const published = items.map((item) => fromItem(item)).filter((m) => m.status === 'PUBLISHED');
    return published[0] ?? null;
  }

  async publishWithSupersedeAndOutbox(
    newMetadata: TemplateMetadata,
    previousPublishedToDeactivate: TemplateMetadata | null,
    event: TemplateEvent,
  ): Promise<void> {
    const metadata = { ...newMetadata };
    delete (metadata as { legacyInlineDocument?: unknown }).legacyInlineDocument;
    const eventId = randomUUID();
    const transactItems: Array<Record<string, unknown>> = [];

    if (previousPublishedToDeactivate) {
      const prev = previousPublishedToDeactivate;
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: {
            pk: orgPk(prev.orgId),
            sk: templateVersionSk(prev.templateId, prev.version),
          },
          UpdateExpression: 'SET #status = :inactive, #updatedAt = :now REMOVE gsi3pk, gsi3sk',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':inactive': 'INACTIVE',
            ':now': metadata.updatedAt,
            ':p1': 'PUBLISHED',
            ':p2': 'published',
          },
          ConditionExpression: '#status IN (:p1, :p2)',
        },
      });
    }

    transactItems.push({
      Put: {
        TableName: this.tableName,
        Item: toItem(metadata as TemplateMetadata),
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      },
    });

    transactItems.push({
      Put: {
        TableName: this.tableName,
        Item: toOutboxItem(event, eventId),
      },
    });

    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems as never,
      }) as never,
    );
  }

  async putMetadata(template: TemplateMetadata): Promise<void> {
    const metadata = { ...template };
    delete (metadata as { legacyInlineDocument?: unknown }).legacyInlineDocument;
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toItem(metadata as TemplateMetadata),
      }) as never,
    );
  }

  async putMetadataWithOutbox(template: TemplateMetadata, event: TemplateEvent): Promise<void> {
    const metadata = { ...template };
    delete (metadata as { legacyInlineDocument?: unknown }).legacyInlineDocument;
    const eventId = randomUUID();

    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: toItem(metadata as TemplateMetadata),
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: toOutboxItem(event, eventId),
            },
          },
        ],
      }) as never,
    );
  }

  async listPendingEvents(limit: number): Promise<TemplateOutboxEventRecord[]> {
    const res = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'gsi2pk = :gpk',
        ExpressionAttributeValues: {
          ':gpk': outboxStatusPk('PENDING'),
        },
        Limit: limit,
      }) as never,
    )) as { Items?: Record<string, unknown>[] };

    return (res.Items ?? []).map((item) => fromOutboxItem(item));
  }

  async markEventSent(eventId: string, sentAt: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: outboxPk(eventId), sk: outboxSk() },
        UpdateExpression: 'SET #status = :status, sentAt = :sentAt, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk, ttl = :ttl',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'SENT',
          ':sentAt': sentAt,
          ':gsi2pk': outboxStatusPk('SENT'),
          ':gsi2sk': outboxStatusSk(sentAt, eventId),
          ':ttl': Math.floor(new Date(sentAt).getTime() / 1000) + 7 * 24 * 60 * 60,
        },
      }) as never,
    );
  }

  async getRuntimeBinding(patientId: string, templateId: string): Promise<RuntimeTemplateBinding | null> {
    const res = (await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: runtimeBindingPk(patientId),
          sk: runtimeBindingSk(templateId),
        },
      }) as never,
    )) as { Item?: Record<string, unknown> };

    if (!res.Item) return null;
    return fromRuntimeBindingItem(res.Item);
  }

  async bindRuntimeVersion(binding: RuntimeTemplateBinding): Promise<RuntimeTemplateBinding> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toRuntimeBindingItem(binding),
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }) as never,
    );

    return binding;
  }

  async getResult<T>(idempotencyKey: string): Promise<T | null> {
    const res = (await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: idempotencyPk(idempotencyKey), sk: idempotencySk() },
      }) as never,
    )) as { Item?: TemplateIdempotencyItem };

    return (res.Item?.result as T | undefined) ?? null;
  }

  async saveResult<T>(idempotencyKey: string, result: T): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toIdempotencyItem(idempotencyKey, result),
      }) as never,
    );
  }
}
