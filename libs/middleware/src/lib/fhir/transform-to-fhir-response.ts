import {
  BundleBuilder,
  FhirTransformationService,
  type FhirCollectionBundle,
} from '@api-hub/fhir';
import type { LambdaRequest } from '@api-hub/utils';

export type FhirHandlerOptions = {
  enabled?: boolean;
  resourceType?: string;
  resource?: string;
  resources?: string[];
  version?: 'R4';
};

export type FhirResponsePayload = {
  headers: {
    'Content-Type': 'application/fhir+json';
  };
  body: unknown;
};

const fhirTransformation = new FhirTransformationService();
const bundleBuilder = new BundleBuilder();

function resolveClientId(req: LambdaRequest): string {
  const ctx = req.context as unknown as Record<string, unknown> | undefined;
  const headerClientId =
    req.event?.headers?.['x-client-id'] ??
    req.event?.headers?.['X-Client-Id'];

  return (
    (typeof ctx?.clientId === 'string' ? ctx.clientId : undefined) ||
    headerClientId ||
    'default'
  );
}

export function isFhirEnabled(options?: FhirHandlerOptions): boolean {
  if (!options) {
    return false;
  }

  return (
    options.enabled === true ||
    Boolean(options.resourceType) ||
    Boolean(options.resource) ||
    Boolean(options.resources?.length)
  );
}

function resolveExplicitResourceTypes(
  options: FhirHandlerOptions,
): string[] | undefined {
  if (options.resources?.length) {
    return options.resources;
  }

  const single = options.resource ?? options.resourceType;
  return single ? [single] : undefined;
}

/**
 * Builds a FHIR collection Bundle projection from a canonical handler result.
 * Returns undefined when no resources could be generated.
 */
export async function transformToFhirResponse(
  result: unknown,
  options: FhirHandlerOptions,
  req: LambdaRequest,
): Promise<FhirCollectionBundle | undefined> {
  const clientId = resolveClientId(req);
  const resourceTypes = resolveExplicitResourceTypes(options);

  const resources = await fhirTransformation.transformToProjection(result, {
    resourceTypes,
    clientId,
    version: options.version,
  });

  if (resources.length === 0) {
    return undefined;
  }

  return bundleBuilder.build(resources);
}
