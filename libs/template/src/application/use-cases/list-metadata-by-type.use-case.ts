import type { MetadataDefinition } from '../../domain/metadata-definition.types';
import type { MetadataListStatusFilter, MetadataRepository } from '../metadata-repository.port';
import type { ListMetadataByTypeInput } from '../dto';

export class ListMetadataByTypeUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: ListMetadataByTypeInput): Promise<MetadataDefinition[]> {
    const filter: MetadataListStatusFilter = input.status ?? 'all';
    return this.metadataRepository.listMetadataByType(input.metadataType, filter);
  }
}
