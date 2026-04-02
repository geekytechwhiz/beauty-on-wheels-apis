import {
  mergeMetadataAndDocument,
  type TemplateDefinition,
} from '../../domain';
import { normalizeTemplateStatus } from '../../domain/template-status';
import type { GetTemplateInput } from '../dto';
import type { TemplateDocumentLoader } from '../dto';
import { TemplateResolver } from '../template-resolver';
import type { TemplateRepository } from '../template-repository.port';

export class GetTemplateUseCase {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly resolver: TemplateResolver,
    private readonly loadDocument: TemplateDocumentLoader,
  ) {}

  async execute(input: GetTemplateInput): Promise<TemplateDefinition | null> {
    const view = input.view ?? 'published';

    if (view === 'published') {
      if (input.version) {
        const meta = await this.repository.getByKey(input.orgId, input.templateId, input.version);
        if (!meta) return null;
        if (normalizeTemplateStatus(meta.status) !== 'PUBLISHED') {
          return null;
        }
        return this.resolver.getRaw(input.orgId, input.templateId, input.version);
      }
      const published = await this.repository.getPublishedVersion(input.orgId, input.templateId);
      if (!published) return null;
      const document = await this.loadDocument(published);
      return mergeMetadataAndDocument(published, document);
    }

    if (input.version) {
      return this.resolver.getRaw(input.orgId, input.templateId, input.version);
    }

    const metadata = await this.resolver.pickLatestMetadata(input.orgId, input.templateId);
    if (!metadata) return null;

    const document = await this.loadDocument(metadata);
    return mergeMetadataAndDocument(metadata, document);
  }
}
