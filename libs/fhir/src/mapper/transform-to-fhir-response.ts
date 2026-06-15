import { BundleBuilder } from '../builders/BundleBuilder';
import { transformOrganizationDetailToFhirBundle } from './organization-detail-fhir.transform';
import { transformOrganizationMetadataToFhirBundle } from './organization-metadata-fhir.transform';
import { FhirTransformationService } from '../services/fhir-transformation.service';
import type { FhirCollectionBundle } from '../types/fhir-bundle';
import type { LambdaRequest } from '@api-hub/utils';

export type FhirHandlerOptions = {
  enabled?: boolean;
  resourceType?: string;
  resource?: string;
  resources?: string[];
  version?: 'R4';
  /**
   * Derive FHIR resource type per payload (e.g. Patient vs Practitioner from userType / roleName).
   * When set, each row is mapped to a single resource instead of multi-resource discovery.
   */
  inferResourceType?: (payload: unknown) => string | undefined;
  /**
   * Use `req.context.fhirResourceType` when set by the handler before returning.
   */
  resourceTypeFromContext?: boolean;
  /**
   * Dot path to a nested array on the handler result (e.g. `data.items`). Top-level arrays need no path.
   */
  resourceListPath?: string;
  /**
   * Shapes inbound FHIR bodies into handler-specific canonical contracts.
   */
  inboundProfile?:
    | 'createUser'
    | 'createOrganization'
    | 'createAppointment'
    | 'createObservation'
    | 'assignDoctor'
    | 'activateDeactivate';
  /**
   * Composite outbound projections (e.g. getOrganization → multi-resource Bundle).
   */
  outboundProfile?: 'organizationDetail' | 'organizationMetadata';
  /**
   * Post-projection FHIR validation (bundle + nested resources).
   */
  validation?: {
    enabled?: boolean;
    failOnValidationError?: boolean;
  };
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
    Boolean(options.resources?.length) ||
    typeof options.inferResourceType === 'function' ||
    options.resourceTypeFromContext === true ||
    options.inboundProfile === 'createUser' ||
    options.inboundProfile === 'createOrganization' ||
    options.inboundProfile === 'assignDoctor' ||
    options.inboundProfile === 'activateDeactivate' ||
    options.outboundProfile === 'organizationDetail' ||
    options.outboundProfile === 'organizationMetadata'
  );
}

function getAtPath(obj: unknown, path: string): unknown {
  if (path.trim() === '' || obj == null || typeof obj !== 'object') {
    return undefined;
  }
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function collectHandlerRows(result: unknown, listPath?: string): unknown[] {
  const trimmedPath = listPath?.trim() ?? '';
  if (Array.isArray(result)) {
    return result;
  }
  if (trimmedPath !== '') {
    const nested = getAtPath(result, trimmedPath);
    if (Array.isArray(nested)) {
      return nested;
    }
  }
  if (result != null && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
    return (result as { items: unknown[] }).items;
  }
  return [result];
}

function resolveFhirResourceType(
  options: FhirHandlerOptions,
  req: LambdaRequest,
  payload: unknown,
): string | undefined {
  if (typeof options.inferResourceType === 'function') {
    const inferred = options.inferResourceType(payload);
    if (typeof inferred === 'string' && inferred.trim() !== '') {
      return inferred.trim();
    }
  }
  if (options.resourceTypeFromContext) {
    const ctx = req.context as { fhirResourceType?: string } | undefined;
    if (
      typeof ctx?.fhirResourceType === 'string' &&
      ctx.fhirResourceType.trim() !== ''
    ) {
      return ctx.fhirResourceType.trim();
    }
  }
  const explicit = resolveExplicitResourceTypes(options);
  return explicit?.[0];
}

async function transformWithInferredResourceTypes(
  result: unknown,
  options: FhirHandlerOptions,
  req: LambdaRequest,
  clientId: string,
): Promise<Record<string, unknown>[]> {
  const rows = collectHandlerRows(result, options.resourceListPath);
  const resources: Record<string, unknown>[] = [];

  for (const row of rows) {
    const resourceType = resolveFhirResourceType(options, req, row);
    if (!resourceType) {
      continue;
    }
    const transformed = await fhirTransformation.transformCanonicalToFhir(
      resourceType,
      row,
      clientId,
      { validate: true, version: options.version },
    );
    resources.push(transformed);
  }

  return resources;
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
  if (options.outboundProfile === 'organizationDetail') {
    return transformOrganizationDetailToFhirBundle(result);
  }

  if (options.outboundProfile === 'organizationMetadata') {
    return transformOrganizationMetadataToFhirBundle(result);
  }

  const clientId = resolveClientId(req);

  const usePerRowResolution =
    typeof options.inferResourceType === 'function' ||
    options.resourceTypeFromContext === true;

  const resources = usePerRowResolution
    ? await transformWithInferredResourceTypes(result, options, req, clientId)
    : await fhirTransformation.transformToProjection(result, {
        resourceTypes: resolveExplicitResourceTypes(options),
        clientId,
        version: options.version,
      });

  if (resources.length === 0) {
    return undefined;
  }

  return bundleBuilder.build(resources);
}
