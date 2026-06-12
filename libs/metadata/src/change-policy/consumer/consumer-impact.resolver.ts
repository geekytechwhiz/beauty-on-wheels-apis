import type {
  MetadataConsumerContext,
  ResolveMetadataConsumerContextInput,
} from './consumer-impact.types';

/**
 * Resolves consumers that currently reference published metadata.
 * First-time creates cannot be referenced yet; cross-service lookups will extend this resolver.
 */
export async function resolveMetadataConsumerContext(
  input: ResolveMetadataConsumerContextInput,
): Promise<MetadataConsumerContext> {
  if (input.isFirstTimeCreate) {
    return { adoptedConsumers: [] };
  }

  // TODO: query template-service, organization-service, package-service, etc. for live references.
  return { adoptedConsumers: [] };
}
