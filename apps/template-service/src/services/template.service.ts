import { S3Client } from '@aws-sdk/client-s3';
import {
  JsonRuleEngine,
  mergeMetadataAndDocument,
  parseTemplateDocument,
  TemplateDdbRepository,
  TemplateExecutor,
  TemplateResolver,
  TEMPLATE_MASTER_ORG_ID,
  nextVersionFromList,
  type CreateTemplateBody,
  type ExecuteTemplateBody,
  type TemplateDefinition,
  type TemplateDocument,
  type TemplateDocumentLoader,
  type TemplateMetadata,
  type TemplateMetadataStore,
  type UpdateTemplateBody,
} from '@api-hub/template-core';
import { S3TemplateStorage } from '@api-hub/template-storage';
import { ddbDocClient } from '@api-hub/utils';

export class TemplateService {
  private readonly resolver: TemplateResolver;
  private readonly executor: TemplateExecutor;

  constructor(
    private readonly repo: TemplateMetadataStore,
    private readonly storage: S3TemplateStorage,
    private readonly loadDocument: TemplateDocumentLoader,
  ) {
    this.resolver = new TemplateResolver(repo, loadDocument);
    this.executor = new TemplateExecutor(new JsonRuleEngine());
  }

  async createTemplate(orgId: string, body: CreateTemplateBody): Promise<TemplateDefinition> {
    const now = new Date().toISOString();
    const storageOrgId = body.type === 'MASTER' ? TEMPLATE_MASTER_ORG_ID : orgId;
    const existing = await this.repo.listVersionsForTemplate(storageOrgId, body.templateId);
    const version =
      body.version ??
      nextVersionFromList(existing.map((m) => m.version));
    if (existing.some((m) => m.version === version)) {
      throw new Error('TEMPLATE_VERSION_EXISTS');
    }

    const document: TemplateDocument = {
      config: body.config,
      rules: body.rules ?? {},
      actions: body.actions ?? [],
    };

    const schemaRef = this.storage.generateS3Key({
      orgId: storageOrgId,
      templateId: body.templateId,
      version,
      type: body.type,
    });

    await this.storage.uploadTemplate(schemaRef, document);

    const meta: TemplateMetadata = {
      templateId: body.templateId,
      orgId: storageOrgId,
      version,
      type: body.type,
      status: body.status,
      baseTemplateId: body.extendsTemplateId,
      baseVersion: body.extendsVersion,
      baseOrgId: body.extendsBaseOrgId,
      schemaRef,
      createdAt: now,
      updatedAt: now,
      createdBy: body.createdBy,
    };
    await this.repo.putMetadata(meta);
    return mergeMetadataAndDocument(meta, document);
  }

  async getTemplate(
    orgId: string,
    templateId: string,
    version?: string,
  ): Promise<TemplateDefinition | null> {
    const meta = version
      ? await this.repo.getByKey(orgId, templateId, version)
      : await this.pickLatestMetadata(orgId, templateId);
    if (!meta) return null;
    const doc = await this.loadDocument(meta);
    return mergeMetadataAndDocument(meta, doc);
  }

  private async pickLatestMetadata(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    const versions = await this.repo.listVersionsForTemplate(orgId, templateId);
    if (versions.length === 0) return null;
    versions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return versions[0] ?? null;
  }

  async updateTemplate(orgId: string, templateId: string, body: UpdateTemplateBody): Promise<TemplateDefinition> {
    const now = new Date().toISOString();
    const source = await this.repo.getByKey(orgId, templateId, body.version);
    if (!source) {
      throw new Error('TEMPLATE_NOT_FOUND');
    }

    const sourceDoc = await this.loadDocument(source);
    const mergedDoc: TemplateDocument = {
      config: body.config ?? sourceDoc.config,
      rules: body.rules ?? sourceDoc.rules,
      actions: body.actions ?? sourceDoc.actions,
    };

    const all = await this.repo.listVersionsForTemplate(orgId, templateId);
    const newVersion = nextVersionFromList(all.map((m) => m.version));
    if (all.some((m) => m.version === newVersion)) {
      throw new Error('TEMPLATE_VERSION_COLLISION');
    }

    const schemaRef = this.storage.generateS3Key({
      orgId: source.orgId,
      templateId,
      version: newVersion,
      type: source.type,
    });

    await this.storage.uploadTemplate(schemaRef, mergedDoc);

    const meta: TemplateMetadata = {
      templateId,
      orgId: source.orgId,
      version: newVersion,
      type: source.type,
      status: body.status ?? source.status,
      baseTemplateId: body.extendsTemplateId ?? source.baseTemplateId,
      baseVersion: body.extendsVersion ?? source.baseVersion,
      baseOrgId: body.extendsBaseOrgId ?? source.baseOrgId,
      schemaRef,
      createdAt: source.createdAt,
      updatedAt: now,
      createdBy: source.createdBy,
    };
    await this.repo.putMetadata(meta);
    return mergeMetadataAndDocument(meta, mergedDoc);
  }

  async executeTemplate(orgId: string, templateId: string, body: ExecuteTemplateBody) {
    const resolved = await this.resolver.resolve(orgId, templateId, body.version);
    return this.executor.execute(resolved, body.context);
  }
}

function getTableName(): string {
  const t = process.env.TEMPLATE_TABLE ?? '';
  if (!t) throw new Error('TEMPLATE_TABLE is not configured');
  return t;
}

function getBucketName(): string {
  const b = process.env.TEMPLATE_BUCKET ?? '';
  if (!b) throw new Error('TEMPLATE_BUCKET is not configured');
  return b;
}

function buildDocumentLoader(storage: S3TemplateStorage): TemplateDocumentLoader {
  return async (meta: TemplateMetadata) => {
    if (meta.legacyInlineDocument) {
      return meta.legacyInlineDocument;
    }
    if (!meta.schemaRef?.trim()) {
      throw new Error('TEMPLATE_SCHEMA_REF_MISSING');
    }
    const raw = await storage.getTemplate(meta.schemaRef);
    return parseTemplateDocument(raw);
  };
}

let s3Storage: S3TemplateStorage | null = null;

function getS3Storage(): S3TemplateStorage {
  if (!s3Storage) {
    s3Storage = new S3TemplateStorage(
      new S3Client({ region: process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1' }),
      getBucketName(),
    );
  }
  return s3Storage;
}

let singleton: TemplateService | null = null;

export function getTemplateService(): TemplateService {
  if (!singleton) {
    const repo: TemplateMetadataStore = new TemplateDdbRepository(ddbDocClient, getTableName());
    const storage = getS3Storage();
    singleton = new TemplateService(repo, storage, buildDocumentLoader(storage));
  }
  return singleton;
}
