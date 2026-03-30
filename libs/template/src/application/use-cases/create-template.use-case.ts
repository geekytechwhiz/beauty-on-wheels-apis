import {
  mergeMetadataAndDocument,
  nextVersionFromList,
  type TemplateDefinition,
  type TemplateDocument,
  type TemplateMetadata,
} from '../../domain';
import { TemplateVersionExistsError } from '../../shared';
import { TEMPLATE_MASTER_ORG_ID } from '../../policies';
import type { CreateTemplateInput } from '../dto';
import type { TemplateRepository } from '../template-repository.port';
import type { TemplateStorage } from '../template-storage.port';

export class CreateTemplateUseCase {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly storage: TemplateStorage,
  ) {}

  async execute(input: CreateTemplateInput): Promise<TemplateDefinition> {
    const now = new Date().toISOString();
    const storageOrgId =
      input.body.type === 'MASTER' ? TEMPLATE_MASTER_ORG_ID : input.orgId;
    const existing = await this.repository.listVersionsForTemplate(storageOrgId, input.body.templateId);
    const version = input.body.version ?? nextVersionFromList(existing.map((item) => item.version));

    if (existing.some((item) => item.version === version)) {
      throw new TemplateVersionExistsError();
    }

    const document: TemplateDocument = {
      config: input.body.config,
      rules: input.body.rules ?? {},
      actions: input.body.actions ?? [],
    };

    const schemaRef = this.storage.generateKey({
      orgId: storageOrgId,
      templateId: input.body.templateId,
      version,
      type: input.body.type,
    });

    await this.storage.uploadTemplate(schemaRef, document);

    const metadata: TemplateMetadata = {
      templateId: input.body.templateId,
      orgId: storageOrgId,
      version,
      type: input.body.type,
      status: input.body.status,
      baseTemplateId: input.body.extendsTemplateId,
      baseVersion: input.body.extendsVersion,
      baseOrgId: input.body.extendsBaseOrgId,
      schemaRef,
      createdAt: now,
      updatedAt: now,
      createdBy: input.body.createdBy,
    };

    await this.repository.putMetadata(metadata);
    return mergeMetadataAndDocument(metadata, document);
  }
}
