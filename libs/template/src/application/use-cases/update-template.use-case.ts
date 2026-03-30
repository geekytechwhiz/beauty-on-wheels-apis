import {
  mergeMetadataAndDocument,
  nextVersionFromList,
  type TemplateDefinition,
  type TemplateDocument,
  type TemplateMetadata,
} from '../../domain';
import { TemplateNotFoundError, TemplateVersionConflictError } from '../../shared';
import type { TemplateDocumentLoader, UpdateTemplateInput } from '../dto';
import type { TemplateRepository } from '../template-repository.port';
import type { TemplateStorage } from '../template-storage.port';

export class UpdateTemplateUseCase {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly storage: TemplateStorage,
    private readonly loadDocument: TemplateDocumentLoader,
  ) {}

  async execute(input: UpdateTemplateInput): Promise<TemplateDefinition> {
    const now = new Date().toISOString();
    const source = await this.repository.getByKey(input.orgId, input.templateId, input.body.version);

    if (!source) {
      throw new TemplateNotFoundError();
    }

    const sourceDocument = await this.loadDocument(source);
    const mergedDocument: TemplateDocument = {
      config: input.body.config ?? sourceDocument.config,
      rules: input.body.rules ?? sourceDocument.rules,
      actions: input.body.actions ?? sourceDocument.actions,
    };

    const allVersions = await this.repository.listVersionsForTemplate(input.orgId, input.templateId);
    const newVersion = nextVersionFromList(allVersions.map((item) => item.version));

    if (allVersions.some((item) => item.version === newVersion)) {
      throw new TemplateVersionConflictError();
    }

    const schemaRef = this.storage.generateKey({
      orgId: source.orgId,
      templateId: input.templateId,
      version: newVersion,
      type: source.type,
    });

    await this.storage.uploadTemplate(schemaRef, mergedDocument);

    const metadata: TemplateMetadata = {
      templateId: input.templateId,
      orgId: source.orgId,
      version: newVersion,
      type: source.type,
      status: input.body.status ?? source.status,
      baseTemplateId: input.body.extendsTemplateId ?? source.baseTemplateId,
      baseVersion: input.body.extendsVersion ?? source.baseVersion,
      baseOrgId: input.body.extendsBaseOrgId ?? source.baseOrgId,
      schemaRef,
      createdAt: source.createdAt,
      updatedAt: now,
      createdBy: source.createdBy,
    };

    await this.repository.putMetadata(metadata);
    return mergeMetadataAndDocument(metadata, mergedDocument);
  }
}
