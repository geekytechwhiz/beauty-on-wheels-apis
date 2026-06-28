export class TaskMetadataRegistryUnavailableError extends Error {
  readonly statusCode = 502;
  readonly code = 'METADATA_REGISTRY_UNAVAILABLE';

  constructor(message = 'Metadata registry is unavailable') {
    super(message);
    this.name = 'TaskMetadataRegistryUnavailableError';
  }
}
