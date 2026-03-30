import { mergeMetadataAndDocument, type TemplateDefinition } from '../../domain';
import type { GetTemplateInput } from '../dto';
import type { TemplateDocumentLoader } from '../dto';
import { TemplateResolver } from '../template-resolver';

export class GetTemplateUseCase {
  constructor(private readonly resolver: TemplateResolver, private readonly loadDocument: TemplateDocumentLoader) {}

  async execute(input: GetTemplateInput): Promise<TemplateDefinition | null> {
    if (input.version) {
      return this.resolver.getRaw(input.orgId, input.templateId, input.version);
    }

    const metadata = await this.resolver.pickLatestMetadata(input.orgId, input.templateId);
    if (!metadata) return null;

    const document = await this.loadDocument(metadata);
    return mergeMetadataAndDocument(metadata, document);
  }
}
