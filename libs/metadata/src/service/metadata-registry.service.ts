import type { IMetadataRegistryRepository } from '../repository/metadata-registry.repository.interface';

/**
 * Application service facade over {@link IMetadataRegistryRepository}.
 * Handlers depend on this to keep Lambda handlers thin and testable.
 */
export class MetadataRegistryService {
  constructor(private readonly repo: IMetadataRegistryRepository) {}

  get repository(): IMetadataRegistryRepository {
    return this.repo;
  }
}
