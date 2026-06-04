type AnyObject = Record<string, unknown>;

const FHIR_ORG_CODE_TO_TYPE: Record<string, string> = {
  prov: 'HOSPITAL',
  dept: 'HOSPITAL',
  team: 'HOSPITAL',
  healthcare: 'HOSPITAL',
};

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Prefer values that look like emails; ignores phone numbers mapped onto email fields. */
function pickEmail(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '' && looksLikeEmail(value)) {
      return value.trim();
    }
  }
  return undefined;
}

/** Prefer non-email contact values (phone numbers). */
function pickPhone(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed === '' || looksLikeEmail(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return undefined;
}

function asRecord(value: unknown): AnyObject | undefined {
  return value && typeof value === 'object' ? (value as AnyObject) : undefined;
}

function inferOrganizationTypeFromFhir(resource: AnyObject): string {
  const typeEntry = Array.isArray(resource.type)
    ? asRecord(resource.type[0])
    : undefined;

  const text = pickString(typeEntry?.text);
  if (text) {
    return text.toUpperCase();
  }

  const coding = Array.isArray(typeEntry?.coding)
    ? asRecord(typeEntry.coding[0])
    : undefined;
  const code = pickString(coding?.code)?.toLowerCase();
  if (code && FHIR_ORG_CODE_TO_TYPE[code]) {
    return FHIR_ORG_CODE_TO_TYPE[code];
  }
  if (code) {
    return code.toUpperCase();
  }

  return 'HOSPITAL';
}

function parseTelecom(resource: AnyObject): {
  email?: string;
  phone?: string;
} {
  const telecom = Array.isArray(resource.telecom) ? resource.telecom : [];
  let email: string | undefined;
  let phone: string | undefined;

  for (const entry of telecom) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }
    const system = pickString(item.system)?.toLowerCase();
    const value = pickString(item.value);
    if (!value) {
      continue;
    }
    if (system === 'email') {
      email = value;
    } else if (system === 'phone') {
      phone = value;
    }
  }

  return { email, phone };
}

function parseAddress(resource: AnyObject): AnyObject {
  const addressEntry = Array.isArray(resource.address)
    ? asRecord(resource.address[0])
    : undefined;
  if (!addressEntry) {
    return {};
  }

  const line = Array.isArray(addressEntry.line)
    ? pickString(addressEntry.line[0])
    : pickString(addressEntry.line);

  return Object.fromEntries(
    Object.entries({
      address: line,
      city: pickString(addressEntry.city),
      state: pickString(addressEntry.state),
      country: pickString(addressEntry.country),
      postalCode: pickString(addressEntry.postalCode),
      countryCode: pickString(addressEntry.countryCode),
    }).filter(([, value]) => value !== undefined),
  );
}

/**
 * Shapes FHIR Organization (and generic reverse-map output) into the canonical
 * create-organization contract expected by normalizeOrganizationPayload.
 */
export function enrichCreateOrganizationCanonical(
  fhirResource: AnyObject,
  canonical: AnyObject,
): AnyObject {
  const nestedOrgInfo = asRecord(canonical.organizationInfo);
  const name = pickString(
    canonical.name,
    canonical.organizationName,
    nestedOrgInfo?.organizationName,
    nestedOrgInfo?.name,
    fhirResource.name,
  );
  const organizationType = pickString(
    canonical.organizationType,
    nestedOrgInfo?.organizationType,
    inferOrganizationTypeFromFhir(fhirResource),
  );
  const organizationId = pickString(
    canonical.organizationId,
    canonical.organizationID,
    nestedOrgInfo?.organizationID,
    nestedOrgInfo?.organizationId,
    fhirResource.id,
  );

  const telecom = parseTelecom(fhirResource);
  const address = {
    ...parseAddress(fhirResource),
    ...asRecord(nestedOrgInfo?.address),
  };

  const emailAddress = pickEmail(
    telecom.email,
    canonical.email,
    canonical.emailAddress,
    nestedOrgInfo?.emailAddress,
  );
  const phone = pickPhone(
    telecom.phone,
    canonical.phone,
    canonical.phoneNumber,
    nestedOrgInfo?.phoneNumber,
  );

  const organizationInfo: AnyObject = {
    ...nestedOrgInfo,
    ...(organizationId ? { organizationID: organizationId } : {}),
    organizationName: name,
    name,
    organizationType,
    emailAddress,
    ...(phone ? { phoneNumber: phone } : {}),
    address,
  };

  return {
    ...canonical,
    ...(organizationId ? { organizationId, organizationID: organizationId } : {}),
    name,
    organizationType,
    email: emailAddress,
    phone,
    address: pickString(canonical.address, address.address as string),
    city: pickString(canonical.city, address.city as string),
    state: pickString(canonical.state, address.state as string),
    country: pickString(canonical.country, address.country as string),
    postalCode: pickString(canonical.postalCode, address.postalCode as string),
    countryCode: pickString(canonical.countryCode, address.countryCode as string),
    organizationInfo,
  };
}
