import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { S3Client } from '@aws-sdk/client-s3';
import { ddbDocClient } from '@api-hub/utils';
import { CreateCarePlanDraftUseCase } from '@api-hub/care-plan';
import { getDefaultGlobalRules, JsonRuleEngine } from '@api-hub/rule-engine';
import {
  BindRuntimeTemplateUseCase,
  buildTemplateDocumentLoader,
  CreateTemplateUseCase,
  ExecuteTemplateUseCase,
  GetTemplateUseCase,
  ProcessTemplateOutboxUseCase,
  PublishTemplateUseCase,
  S3TemplateStorage,
  TemplateEventBridgePublisher,
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

function getEventBusName(): string {
  return process.env.EVENT_BUS ?? 'default';
}

function isGlobalRulesEnabled(): boolean {
  const v = process.env.TEMPLATE_GLOBAL_RULES_ENABLED;
  if (v === undefined || v === '') {
    return true;
  }
  return v !== 'false' && v !== '0';
}

export interface TemplateRuntime {
  createTemplateUseCase: CreateTemplateUseCase;
  getTemplateUseCase: GetTemplateUseCase;
  updateTemplateUseCase: UpdateTemplateUseCase;
  publishTemplateUseCase: PublishTemplateUseCase;
  executeTemplateUseCase: ExecuteTemplateUseCase;
  createCarePlanDraftUseCase: CreateCarePlanDraftUseCase;
  processTemplateOutboxUseCase: ProcessTemplateOutboxUseCase;
  bindRuntimeTemplateUseCase: BindRuntimeTemplateUseCase;
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
  const globalRules = isGlobalRulesEnabled() ? getDefaultGlobalRules() : [];
  const executeTemplateUseCase = new ExecuteTemplateUseCase(resolver, ruleEngine, globalRules);
  const createCarePlanDraftUseCase = new CreateCarePlanDraftUseCase(executeTemplateUseCase);
  const eventPublisher = new TemplateEventBridgePublisher(
    new EventBridgeClient({ region: process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1' }),
    getEventBusName(),
  );

  runtimeSingleton = {
    createTemplateUseCase: new CreateTemplateUseCase(repository, storage, loadDocument, repository),
    getTemplateUseCase: new GetTemplateUseCase(repository, resolver, loadDocument),
    updateTemplateUseCase: new UpdateTemplateUseCase(repository, storage, loadDocument, repository),
    publishTemplateUseCase: new PublishTemplateUseCase(repository, loadDocument, storage, repository),
    executeTemplateUseCase,
    createCarePlanDraftUseCase,
    processTemplateOutboxUseCase: new ProcessTemplateOutboxUseCase(repository, eventPublisher),
    bindRuntimeTemplateUseCase: new BindRuntimeTemplateUseCase(repository, repository),
  };

  return runtimeSingleton;
}
