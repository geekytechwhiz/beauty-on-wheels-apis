import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { S3Client } from '@aws-sdk/client-s3';
import { ddbDocClient } from '@api-hub/utils';
import { CreateCarePlanDraftUseCase } from '@api-hub/care-plan';
import { getDefaultGlobalRules, JsonRuleEngine } from '@api-hub/rule-engine';
import {
  BindRuntimeTemplateUseCase,
  buildTemplateDocumentLoader,
  CreateMetadataDefinitionUseCase,
  CreateTemplateUseCase,
  DeleteMetadataDefinitionUseCase,
  ExecuteTemplateUseCase,
  GetMetadataDefinitionUseCase,
  GetTemplateUseCase,
  ListApplicableMetadataUseCase,
  ListMetadataByTypeUseCase,
  ListMetadataVersionsUseCase,
  MetadataDdbRepository,
  ProcessTemplateOutboxUseCase,
  PublishTemplateUseCase,
  S3TemplateStorage,
  TemplateEventBridgePublisher,
  TemplateDdbRepository,
  TemplateResolver,
  UpdateTemplateUseCase,
  UpsertMetadataDefinitionUseCase,
  ValidationEngine,
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
  listApplicableMetadataUseCase: ListApplicableMetadataUseCase;
  listMetadataByTypeUseCase: ListMetadataByTypeUseCase;
  listMetadataVersionsUseCase: ListMetadataVersionsUseCase;
  getMetadataDefinitionUseCase: GetMetadataDefinitionUseCase;
  createMetadataDefinitionUseCase: CreateMetadataDefinitionUseCase;
  upsertMetadataDefinitionUseCase: UpsertMetadataDefinitionUseCase;
  deleteMetadataDefinitionUseCase: DeleteMetadataDefinitionUseCase;
}

let runtimeSingleton: TemplateRuntime | null = null;

export function getTemplateRuntime(): TemplateRuntime {
  if (runtimeSingleton) {
    return runtimeSingleton;
  }

  const repository = new TemplateDdbRepository(ddbDocClient, getTableName());
  const metadataRepository = new MetadataDdbRepository(ddbDocClient, getTableName());
  const validationEngine = new ValidationEngine(metadataRepository, repository);
  const storage = buildStorage();
  const loadDocument = buildTemplateDocumentLoader(storage);
  const resolver = new TemplateResolver(repository, loadDocument);
  const ruleEngine = new JsonRuleEngine();
  const globalRules = isGlobalRulesEnabled() ? getDefaultGlobalRules() : [];
  const executeTemplateUseCase = new ExecuteTemplateUseCase(resolver, ruleEngine, globalRules);
  const createCarePlanDraftUseCase = new CreateCarePlanDraftUseCase(executeTemplateUseCase);
  const listApplicableMetadataUseCase = new ListApplicableMetadataUseCase(metadataRepository);
  const listMetadataByTypeUseCase = new ListMetadataByTypeUseCase(metadataRepository);
  const listMetadataVersionsUseCase = new ListMetadataVersionsUseCase(metadataRepository);
  const getMetadataDefinitionUseCase = new GetMetadataDefinitionUseCase(metadataRepository);
  const createMetadataDefinitionUseCase = new CreateMetadataDefinitionUseCase(metadataRepository);
  const upsertMetadataDefinitionUseCase = new UpsertMetadataDefinitionUseCase(metadataRepository);
  const deleteMetadataDefinitionUseCase = new DeleteMetadataDefinitionUseCase(metadataRepository);
  const eventPublisher = new TemplateEventBridgePublisher(
    new EventBridgeClient({ region: process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1' }),
    getEventBusName(),
  );

  runtimeSingleton = {
    createTemplateUseCase: new CreateTemplateUseCase(
      repository,
      storage,
      loadDocument,
      validationEngine,
      repository,
    ),
    getTemplateUseCase: new GetTemplateUseCase(repository, resolver, loadDocument),
    updateTemplateUseCase: new UpdateTemplateUseCase(
      repository,
      storage,
      loadDocument,
      validationEngine,
      repository,
    ),
    publishTemplateUseCase: new PublishTemplateUseCase(
      repository,
      loadDocument,
      storage,
      validationEngine,
      repository,
    ),
    executeTemplateUseCase,
    createCarePlanDraftUseCase,
    processTemplateOutboxUseCase: new ProcessTemplateOutboxUseCase(repository, eventPublisher),
    bindRuntimeTemplateUseCase: new BindRuntimeTemplateUseCase(repository, repository),
    listApplicableMetadataUseCase,
    listMetadataByTypeUseCase,
    listMetadataVersionsUseCase,
    getMetadataDefinitionUseCase,
    createMetadataDefinitionUseCase,
    upsertMetadataDefinitionUseCase,
    deleteMetadataDefinitionUseCase,
  };

  return runtimeSingleton;
}
