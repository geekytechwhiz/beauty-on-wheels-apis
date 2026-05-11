import type { MetadataDefinition } from '../../domain/metadata-definition.types';
import type { MetadataRepository } from '../metadata-repository.port';
import type { UpsertMetadataDefinitionInput } from '../dto';

function mergeDefinition(
  input: UpsertMetadataDefinitionInput,
  existing: MetadataDefinition | null,
): MetadataDefinition {
  const now = new Date().toISOString();
  return {
    name: input.name,
    version: input.version,
    type: input.body.type,
    values: input.body.values,
    defaultValue: input.body.defaultValue,
    metadataMode: input.body.metadataMode,
    applicability: input.body.applicability,
    constraints: input.body.constraints,
    status: input.body.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export class UpsertMetadataDefinitionUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: UpsertMetadataDefinitionInput): Promise<MetadataDefinition> {
    const existing = await this.metadataRepository.getMetadataExact(
      input.metadataType,
      input.name,
      input.version,
    );
    const def = mergeDefinition(input, existing);
    await this.metadataRepository.upsertMetadata(input.metadataType, def);
    return def;
  }
}
