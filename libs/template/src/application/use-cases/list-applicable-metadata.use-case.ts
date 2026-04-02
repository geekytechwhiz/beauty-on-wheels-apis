import type { MetadataDefinition } from '../../domain/metadata-definition.types';
import type { MetadataRepository } from '../metadata-repository.port';
import type { ListApplicableMetadataInput } from '../dto';

export class ListApplicableMetadataUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: ListApplicableMetadataInput): Promise<MetadataDefinition[]> {
    return this.metadataRepository.getApplicableMetadata({
      templateType: input.templateType,
      category: input.category,
      condition: input.condition,
      country: input.country,
    });
  }
}
