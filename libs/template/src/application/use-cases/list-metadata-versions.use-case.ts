import type { MetadataDefinition } from '../../domain/metadata-definition.types';
import type { MetadataRepository } from '../metadata-repository.port';
import type { ListMetadataVersionsInput } from '../dto';

export class ListMetadataVersionsUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: ListMetadataVersionsInput): Promise<MetadataDefinition[]> {
    return this.metadataRepository.listVersionsForName(input.metadataType, input.name);
  }
}
