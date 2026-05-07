import type { MetadataDefinition } from '../../domain/metadata-definition.types';
import { MetadataNotFoundError } from '../../shared';
import type { MetadataRepository } from '../metadata-repository.port';
import type { GetMetadataDefinitionInput } from '../dto';

export class GetMetadataDefinitionUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: GetMetadataDefinitionInput): Promise<MetadataDefinition> {
    const found = await this.metadataRepository.getMetadata(
      input.metadataType,
      input.name,
      input.version,
    );
    if (!found) {
      throw new MetadataNotFoundError();
    }
    return found;
  }
}
