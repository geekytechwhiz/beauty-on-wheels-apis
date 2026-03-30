import { S3Client } from '@aws-sdk/client-s3';
import { ddbDocClient } from '@api-hub/utils';
import { JsonRuleEngine } from '@api-hub/rule-engine';
import {
  buildTemplateDocumentLoader,
  CreateTemplateUseCase,
  ExecuteTemplateUseCase,
  GetTemplateUseCase,
  S3TemplateStorage,
  TemplateDdbRepository,
  TemplateResolver,
  UpdateTemplateUseCase,
} from '@api-hub/template';

function getTableName(): string {
  const tableName = process.env.TEMPLATE_TABLE ?? '';
  if (!tableName) {
    throw new Error('TEMPLATE_TABLE is not configured');
  }
  return tableName;
}

function getBucketName(): string {
  const bucketName = process.env.TEMPLATE_BUCKET ?? '';
  if (!bucketName) {
    throw new Error('TEMPLATE_BUCKET is not configured');
  }
  return bucketName;
}

function buildStorage(): S3TemplateStorage {
  return new S3TemplateStorage(
    new S3Client({ region: process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1' }),
    getBucketName(),
  );
}

export interface TemplateRuntime {
  createTemplateUseCase: CreateTemplateUseCase;
  getTemplateUseCase: GetTemplateUseCase;
  updateTemplateUseCase: UpdateTemplateUseCase;
  executeTemplateUseCase: ExecuteTemplateUseCase;
}

let runtimeSingleton: TemplateRuntime | null = null;

export function getTemplateRuntime(): TemplateRuntime {
  if (runtimeSingleton) {
    return runtimeSingleton;
  }

  const repository = new TemplateDdbRepository(ddbDocClient, getTableName());
  const storage = buildStorage();
  const loadDocument = buildTemplateDocumentLoader(storage);
  const resolver = new TemplateResolver(repository, loadDocument);
  const ruleEngine = new JsonRuleEngine();

  runtimeSingleton = {
    createTemplateUseCase: new CreateTemplateUseCase(repository, storage),
    getTemplateUseCase: new GetTemplateUseCase(resolver, loadDocument),
    updateTemplateUseCase: new UpdateTemplateUseCase(repository, storage, loadDocument),
    executeTemplateUseCase: new ExecuteTemplateUseCase(resolver, ruleEngine),
  };

  return runtimeSingleton;
}
