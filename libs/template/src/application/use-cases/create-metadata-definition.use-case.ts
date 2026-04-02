import type { MetadataDefinition } from '../../domain/metadata-definition.types';
import { MetadataDefinitionConflictError } from '../../shared';
import type { MetadataRepository } from '../metadata-repository.port';
import type { CreateMetadataDefinitionInput } from '../dto';

function toNewDefinition(body: CreateMetadataDefinitionInput['body']): MetadataDefinition {
  const now = new Date().toISOString();
  return {
    name: body.name,
    version: body.version,
    type: body.type,
    values: body.values,
    defaultValue: body.defaultValue,
    metadataMode: body.metadataMode,
    applicability: body.applicability,
    constraints: body.constraints,
    status: body.status,
    createdAt: now,
    updatedAt: now,
  };
}

export class CreateMetadataDefinitionUseCase {
  constructor(private readonly metadataRepository: MetadataRepository) {}

  async execute(input: CreateMetadataDefinitionInput): Promise<MetadataDefinition> {
    const existing = await this.metadataRepository.getMetadataExact(
      input.metadataType,
      input.body.name,
      input.body.version,
    );
    if (existing) {
      throw new MetadataDefinitionConflictError();
    }
    const def = toNewDefinition(input.body);
    await this.metadataRepository.upsertMetadata(input.metadataType, def);
    return def;
  }
}
