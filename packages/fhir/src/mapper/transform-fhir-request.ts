import { FhirTransformationService } from '@api-hub/fhir';
import { BaseError } from '@api-hub/utils';
import type { LambdaRequest } from '@api-hub/utils';

import type { FhirHandlerOptions } from './transform-to-fhir-response';
import { isFhirEnabled } from './transform-to-fhir-response';
import { enrichActivateDeactivateFromFhir } from './activate-deactivate-fhir.transform';
import { enrichAssignDoctorFromFhir } from './assign-doctor-fhir.transform';
import { enrichCreateUserCanonical, resolveCreateUserInboundHints } from './create-user-fhir.transform';
import { enrichAppointmentToServicePayload } from './appointment-fhir.transform';
import { enrichObservationFromFhir } from './observation-fhir.transform';

const fhirTransformation = new FhirTransformationService();

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH']);

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

function resolveHttpMethod(req: LambdaRequest): string {
  const method = req.event?.httpMethod;
  return typeof method === 'string' ? method.toUpperCase() : '';
}

export function isMutatingHttpMethod(req: LambdaRequest): boolean {
  return MUTATING_HTTP_METHODS.has(resolveHttpMethod(req));
}

/**
 * Inbound FHIR conversion runs when the caller negotiates FHIR, sends a FHIR
 * resource body, or hits an endpoint with a dedicated inbound profile
 * (assignDoctor / activateDeactivate always accept canonical passthrough too).
 */
export function shouldTransformFhirRequest(
  req: LambdaRequest,
  options: FhirHandlerOptions | undefined,
  fhirRequested: boolean,
): boolean {
  if (!options || !isFhirEnabled(options) || !isMutatingHttpMethod(req)) {
    return false;
  }

  const rawBody = req.body;
  if (rawBody == null || typeof rawBody !== 'object') {
    return false;
  }

  if (fhirRequested) {
    return true;
  }

  if (
    options.inboundProfile === 'assignDoctor' ||
    options.inboundProfile === 'activateDeactivate'
  ) {
    return true;
  }

  return isFhirResourceBody(rawBody);
}

export function isFhirResourceBody(
  body: unknown,
): body is Record<string, unknown> {
  return (
    body != null &&
    typeof body === 'object' &&
    typeof (body as { resourceType?: unknown }).resourceType === 'string'
  );
}

function resolveInboundResourceType(
  body: Record<string, unknown>,
  options: FhirHandlerOptions,
): string | undefined {
  const explicit = options.resourceType ?? options.resource;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit.trim();
  }

  const fromBody = body.resourceType;
  if (typeof fromBody === 'string' && fromBody.trim() !== '') {
    return fromBody.trim();
  }

  if (options.resources?.length === 1) {
    return options.resources[0];
  }

  return undefined;
}

function unwrapBundleResource(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.resourceType !== 'Bundle') {
    return body;
  }

  const entries = body.entry;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new BaseError(
      'FHIR Bundle request must include at least one entry.resource',
      400,
      'FHIR_INVALID_BUNDLE',
    );
  }

  const firstEntry = entries[0] as { resource?: unknown };
  if (!isFhirResourceBody(firstEntry.resource)) {
    throw new BaseError(
      'FHIR Bundle entry is missing a resource',
      400,
      'FHIR_INVALID_BUNDLE',
    );
  }

  return firstEntry.resource;
}

/**
 * Converts an inbound FHIR resource body to canonical form for POST/PUT/PATCH handlers.
 * Sets `req.context.fhirResourceType` for downstream outbound projection.
 */
export async function transformFhirRequest(
  req: LambdaRequest,
  options: FhirHandlerOptions,
): Promise<void> {
  if (!isMutatingHttpMethod(req)) {
    return;
  }

  const rawBody = req.body;
  if (rawBody == null || typeof rawBody !== 'object') {
    return;
  }

  if (options.inboundProfile === 'assignDoctor') {
    req.body = enrichAssignDoctorFromFhir(req, rawBody as Record<string, unknown>);
    const ctx = req.context as unknown as Record<string, unknown>;
    ctx.inboundFhirResource = rawBody;
    ctx.fhirResourceType = (rawBody as Record<string, unknown>).resourceType;
    return;
  }

  if (options.inboundProfile === 'activateDeactivate') {
    req.body = enrichActivateDeactivateFromFhir(req, rawBody as Record<string, unknown>);
    const ctx = req.context as unknown as Record<string, unknown>;
    ctx.inboundFhirResource = rawBody;
    ctx.fhirResourceType = (rawBody as Record<string, unknown>).resourceType;
    return;
  }

  if (!isFhirResourceBody(rawBody)) {
    return;
  }

  const fhirBody = rawBody as Record<string, unknown>;
  const inboundHints =
    options.inboundProfile === 'createUser'
      ? resolveCreateUserInboundHints(req, fhirBody)
      : undefined;

  const fhirResource = unwrapBundleResource(fhirBody);
  const resourceType = resolveInboundResourceType(fhirResource, options);

  if (!resourceType) {
    throw new BaseError(
      'Unable to resolve FHIR resource type for inbound request',
      400,
      'FHIR_RESOURCE_TYPE_REQUIRED',
    );
  }

  // Special-case Appointment and Observation to provide canonical shapes directly
  if (resourceType === 'Appointment') {
    // produce a CreateServiceScheduleRequest-like payload (covers createSchedule/createSession)
    req.body = enrichAppointmentToServicePayload(req, fhirResource);
    const ctx = req.context as unknown as Record<string, unknown>;
    ctx.fhirResourceType = resourceType;
    ctx.inboundFhirResource = fhirResource;
    return;
  }

  if (resourceType === 'Observation') {
    req.body = enrichObservationFromFhir(req, fhirResource);
    const ctx = req.context as unknown as Record<string, unknown>;
    ctx.fhirResourceType = resourceType;
    ctx.inboundFhirResource = fhirResource;
    return;
  }

  const canonical = await fhirTransformation.transformFhirToCanonical(
    resourceType,
    fhirResource,
    resolveClientId(req),
    { version: options.version },
  );

  req.body =
    options.inboundProfile === 'createUser'
      ? enrichCreateUserCanonical(
          fhirResource,
          canonical,
          resourceType,
          inboundHints,
        )
      : canonical;

  const ctx = req.context as unknown as Record<string, unknown>;
  ctx.fhirResourceType = resourceType;
  ctx.inboundFhirResource = fhirResource;
}
