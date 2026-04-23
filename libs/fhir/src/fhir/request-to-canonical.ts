type FhirLikeResource = {
  resourceType?: unknown;
  [key: string]: unknown;
};

type CanonicalPayload = Record<string, unknown>;

function extractTelecomValue(
  telecom: unknown,
  system: 'phone' | 'email'
): string | undefined {
  if (!Array.isArray(telecom)) {
    return undefined;
  }

  const match = telecom.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    return (item as { system?: unknown }).system === system;
  }) as { value?: unknown } | undefined;

  return typeof match?.value === 'string' ? match.value : undefined;
}

function extractManagingOrganization(reference: unknown): string | undefined {
  if (typeof reference !== 'string') {
    return undefined;
  }
  const parts = reference.split('/');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

function mapPatientLikeResource(resource: Record<string, unknown>): CanonicalPayload {
  const nameArray = Array.isArray(resource.name) ? resource.name : [];
  const firstNameEntry = nameArray[0] as { given?: unknown; family?: unknown } | undefined;

  const given =
    firstNameEntry && Array.isArray(firstNameEntry.given)
      ? firstNameEntry.given.find((g) => typeof g === 'string')
      : undefined;
  const family = typeof firstNameEntry?.family === 'string' ? firstNameEntry.family : undefined;

  const phone = extractTelecomValue(resource.telecom, 'phone');
  const email = extractTelecomValue(resource.telecom, 'email');

  const addressArray = Array.isArray(resource.address) ? resource.address : [];
  const firstAddress = addressArray[0] as {
    line?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    country?: unknown;
  } | undefined;

  const line =
    firstAddress && Array.isArray(firstAddress.line)
      ? firstAddress.line.find((v) => typeof v === 'string')
      : undefined;

  const managingOrgRef = (resource.managingOrganization as { reference?: unknown } | undefined)?.reference;
  const organizationId = extractManagingOrganization(managingOrgRef);

  const birthDate =
    typeof resource.birthDate === 'string' ? resource.birthDate : undefined;

  const canonical: CanonicalPayload = {
    id: typeof resource.id === 'string' ? resource.id : undefined,
    userID: typeof resource.id === 'string' ? resource.id : undefined,
    firstName: typeof given === 'string' ? given : undefined,
    lastName: family,
    fullName:
      typeof given === 'string' || typeof family === 'string'
        ? `${given ?? ''} ${family ?? ''}`.trim()
        : undefined,
    gender: typeof resource.gender === 'string' ? resource.gender : undefined,
    birthDate,
    dateOfBirth: birthDate,
    phoneNumber: phone,
    emailAddress: email,
    organizationID: organizationId,
    organizationId,
    active: typeof resource.active === 'boolean' ? resource.active : undefined,
    isActive: typeof resource.active === 'boolean' ? resource.active : undefined,
    addressLine: typeof line === 'string' ? line : undefined,
    city: typeof firstAddress?.city === 'string' ? firstAddress.city : undefined,
    state: typeof firstAddress?.state === 'string' ? firstAddress.state : undefined,
    postalCode:
      typeof firstAddress?.postalCode === 'string' ? firstAddress.postalCode : undefined,
    country: typeof firstAddress?.country === 'string' ? firstAddress.country : undefined,
  };

  return Object.fromEntries(
    Object.entries(canonical).filter(([, value]) => value !== undefined)
  );
}

function mapAppointmentResource(resource: Record<string, unknown>): CanonicalPayload {
  const canonical: CanonicalPayload = {
    id: typeof resource.id === 'string' ? resource.id : undefined,
    status: typeof resource.status === 'string' ? resource.status : undefined,
    start: typeof resource.start === 'string' ? resource.start : undefined,
    end: typeof resource.end === 'string' ? resource.end : undefined,
    description:
      typeof resource.description === 'string' ? resource.description : undefined,
  };

  return Object.fromEntries(
    Object.entries(canonical).filter(([, value]) => value !== undefined)
  );
}

export function convertFhirToCanonical(resource: unknown): CanonicalPayload {
  if (!resource || typeof resource !== 'object') {
    throw new Error('FHIR request payload must be an object');
  }

  const fhir = resource as FhirLikeResource;
  const resourceType = typeof fhir.resourceType === 'string' ? fhir.resourceType : '';

  switch (resourceType) {
    case 'Patient':
    case 'Practitioner':
    case 'RelatedPerson':
      return mapPatientLikeResource(resource as Record<string, unknown>);
    case 'Appointment':
      return mapAppointmentResource(resource as Record<string, unknown>);
    default:
      throw new Error(`Inbound FHIR resourceType "${resourceType}" is not supported for canonical conversion`);
  }
}
