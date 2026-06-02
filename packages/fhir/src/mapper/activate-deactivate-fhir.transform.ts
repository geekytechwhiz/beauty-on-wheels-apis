import type { LambdaRequest } from '@api-hub/utils';

type AnyObject = Record<string, unknown>;

export type ActivateDeactivateCanonical = {
  action?: 'ACTIVATE' | 'DEACTIVATE';
  organizationID?: string;
  patientUserId?: string;
};

const VALID_ACTIONS = new Set(['ACTIVATE', 'DEACTIVATE']);

function getHeader(req: LambdaRequest, name: string): string | undefined {
  const headers = req.event?.headers;
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function pickString(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }

  return undefined;
}

function normalizeAction(value: unknown): 'ACTIVATE' | 'DEACTIVATE' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  return VALID_ACTIONS.has(normalized)
    ? (normalized as 'ACTIVATE' | 'DEACTIVATE')
    : undefined;
}

function extensionSegmentMatches(url: unknown, segments: string[]): boolean {
  if (typeof url !== 'string' || url.trim() === '') {
    return false;
  }

  const lastSegment = url
    .trim()
    .split('/')
    .pop()
    ?.toLowerCase()
    .replace(/_/g, '-');

  if (!lastSegment) {
    return false;
  }

  return segments.some(
    (segment) => lastSegment === segment.toLowerCase().replace(/_/g, '-'),
  );
}

function readExtensionScalar(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.valueString === 'string' && entry.valueString.trim() !== '') {
    return entry.valueString.trim();
  }

  if (typeof entry.valueCode === 'string' && entry.valueCode.trim() !== '') {
    return entry.valueCode.trim();
  }

  if (typeof entry.valueUri === 'string' && entry.valueUri.trim() !== '') {
    return entry.valueUri.trim();
  }

  const reference = entry.valueReference;
  if (reference && typeof reference === 'object') {
    const ref = reference as Record<string, unknown>;
    if (typeof ref.reference === 'string' && ref.reference.trim() !== '') {
      const parts = ref.reference.trim().split('/');
      return parts[parts.length - 1] || ref.reference.trim();
    }
  }

  return undefined;
}

function readExtensionBySegments(
  extensions: unknown,
  segments: string[],
): string | undefined {
  if (!Array.isArray(extensions)) {
    return undefined;
  }

  for (const extension of extensions) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }

    const entry = extension as Record<string, unknown>;
    if (extensionSegmentMatches(entry.url, segments)) {
      const scalar = readExtensionScalar(entry);
      if (scalar) {
        return scalar;
      }
    }

    const nested = readExtensionBySegments(entry.extension, segments);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function readParametersMap(body: AnyObject): Map<string, string> {
  const values = new Map<string, string>();
  if (body.resourceType !== 'Parameters') {
    return values;
  }

  const parameters = body.parameter;
  if (!Array.isArray(parameters)) {
    return values;
  }

  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object') {
      continue;
    }

    const entry = parameter as Record<string, unknown>;
    const name =
      typeof entry.name === 'string' ? entry.name.trim().toLowerCase() : undefined;
    if (!name) {
      continue;
    }

    const scalar = readExtensionScalar(entry);
    if (scalar) {
      values.set(name, scalar);
    }
  }

  return values;
}

function extractResourceId(resource: AnyObject): string | undefined {
  if (typeof resource.id === 'string' && resource.id.trim() !== '') {
    return resource.id.trim();
  }

  const identifiers = resource.identifier;
  if (!Array.isArray(identifiers)) {
    return undefined;
  }

  for (const identifier of identifiers) {
    if (!identifier || typeof identifier !== 'object') {
      continue;
    }

    const value = (identifier as Record<string, unknown>).value;
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return undefined;
}

function extractReferenceId(reference: unknown): string | undefined {
  if (typeof reference !== 'string' || reference.trim() === '') {
    return undefined;
  }

  const parts = reference.trim().split('/');
  return parts[parts.length - 1] || reference.trim();
}

function resolveOrganizationId(req: LambdaRequest, ...sources: AnyObject[]): string | undefined {
  const ctxOrg = (req.context as { userContext?: { organizationId?: string } })
    ?.userContext?.organizationId;

  for (const source of sources) {
    const direct = pickString(
      typeof source.organizationID === 'string' ? source.organizationID : undefined,
      typeof source.organizationId === 'string' ? source.organizationId : undefined,
    );
    if (direct) {
      return direct;
    }

    const fromExtension = readExtensionBySegments(source.extension, [
      'organization-id',
      'organizationid',
    ]);
    if (fromExtension) {
      return fromExtension;
    }
  }

  return pickString(
    getHeader(req, 'x-organization-id'),
    getHeader(req, 'x-organizationid'),
    ctxOrg,
  );
}

function resolveTargetUserId(...sources: AnyObject[]): string | undefined {
  for (const source of sources) {
    const direct = pickString(
      typeof source.patientUserId === 'string' ? source.patientUserId : undefined,
      typeof source.patientUserID === 'string' ? source.patientUserID : undefined,
      typeof source.userId === 'string' ? source.userId : undefined,
      typeof source.userID === 'string' ? source.userID : undefined,
      typeof source.targetUserId === 'string' ? source.targetUserId : undefined,
      typeof source.doctorUserId === 'string' ? source.doctorUserId : undefined,
      typeof source.practitionerId === 'string' ? source.practitionerId : undefined,
      extractReferenceId(source.reference),
      extractResourceId(source),
    );
    if (direct) {
      return direct;
    }

    const fromExtension = readExtensionBySegments(source.extension, [
      'patient-user-id',
      'patientuserid',
      'user-id',
      'userid',
      'target-user-id',
      'doctor-user-id',
      'practitioner-id',
    ]);
    if (fromExtension) {
      return fromExtension;
    }
  }

  return undefined;
}

function resolveAction(...sources: AnyObject[]): 'ACTIVATE' | 'DEACTIVATE' | undefined {
  for (const source of sources) {
    const direct = normalizeAction(source.action);
    if (direct) {
      return direct;
    }

    const fromExtension = readExtensionBySegments(source.extension, [
      'action',
      'activate-deactivate-action',
    ]);
    const fromExt = normalizeAction(fromExtension);
    if (fromExt) {
      return fromExt;
    }
  }

  return undefined;
}

/**
 * Converts inbound FHIR Parameters / resource bodies into activate-deactivate API contract.
 */
export function enrichActivateDeactivateFromFhir(
  req: LambdaRequest,
  rawBody: AnyObject,
): ActivateDeactivateCanonical {
  const parameters = readParametersMap(rawBody);
  const parameterAction = normalizeAction(
    parameters.get('action') ??
      parameters.get('activate-deactivate-action') ??
      parameters.get('status'),
  );
  const parameterUserId = pickString(
    parameters.get('patientuserid'),
    parameters.get('patient-user-id'),
    parameters.get('userid'),
    parameters.get('user-id'),
    parameters.get('targetuserid'),
    parameters.get('target-user-id'),
    parameters.get('doctoruserid'),
    parameters.get('doctor-user-id'),
    parameters.get('practitionerid'),
    parameters.get('practitioner-id'),
  );
  const parameterOrgId = pickString(
    parameters.get('organizationid'),
    parameters.get('organization-id'),
    parameters.get('organization'),
  );

  const subjectResource =
    rawBody.resourceType === 'Practitioner' || rawBody.resourceType === 'Patient'
      ? rawBody
      : undefined;

  const action =
    resolveAction(rawBody) ??
    parameterAction ??
    normalizeAction(getHeader(req, 'x-action')) ??
    normalizeAction(
      pickString(
        getHeader(req, 'x-activate-deactivate-action'),
        getHeader(req, 'x-user-action'),
      ),
    );

  const patientUserId =
    resolveTargetUserId(rawBody, subjectResource ?? {}) ??
    parameterUserId ??
    pickString(
      getHeader(req, 'x-patient-user-id'),
      getHeader(req, 'x-patient-id'),
      getHeader(req, 'x-user-id'),
      getHeader(req, 'x-target-user-id'),
      getHeader(req, 'x-doctor-id'),
      getHeader(req, 'x-practitioner-id'),
    );

  const organizationID =
    parameterOrgId ?? resolveOrganizationId(req, rawBody);

  return {
    action,
    organizationID,
    patientUserId,
  };
}
