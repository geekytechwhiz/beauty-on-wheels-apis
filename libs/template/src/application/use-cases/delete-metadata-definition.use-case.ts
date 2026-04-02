import { MetadataNotFoundError } from '../../shared';
import type { MetadataRepository } from '../metadata-repository.port';
import type { DeleteMetadataDefinitionInput } from '../dto';

export class DeleteMetadataDefinitionUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: DeleteMetadataDefinitionInput): Promise<void> {
    const existing = await this.metadataRepository.getMetadataExact(
      input.metadataType,
      input.name,
      input.version,
    );
    if (!existing) {
      throw new MetadataNotFoundError();
    }
    await this.metadataRepository.deleteMetadata(input.metadataType, input.name, input.version);
  }
}
