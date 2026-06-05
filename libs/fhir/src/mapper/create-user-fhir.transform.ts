import type { LambdaRequest } from '@api-hub/utils';

type AnyObject = Record<string, unknown>;

export const CREATE_USER_EXTENSION_URLS = {
  userType: 'https://myvirtualrx.com/fhir/create-user/userType',
  userRole: 'https://myvirtualrx.com/fhir/create-user/userRole',
  organizationID: 'https://myvirtualrx.com/fhir/create-user/organizationID',
  profilePic: 'https://myvirtualrx.com/fhir/create-user/profilePic',
} as const;

const USER_ROLE_IDENTIFIER_SYSTEMS = new Set([
  'https://myvirtualrx.com/fhir/user-role',
  'https://myvirtualrx.com/fhir/create-user/userRole',
  'urn:myvitalrx:user-role',
]);

export type CreateUserInboundHints = {
  passthrough?: AnyObject;
  headerUserRole?: string[];
  queryUserRole?: string[];
};

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((item) => item.trim()).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }

  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

function extensionUrlMatches(entryUrl: unknown, targetUrl: string): boolean {
  if (typeof entryUrl !== 'string' || entryUrl.trim() === '') {
    return false;
  }

  const normalized = entryUrl.trim();
  if (normalized === targetUrl) {
    return true;
  }

  const suffix = targetUrl.split('/').pop();
  return Boolean(suffix && normalized.endsWith(`/${suffix}`));
}

function readExtensionScalarValue(
  entry: Record<string, unknown>,
): string | undefined {
  if (typeof entry.valueString === 'string' && entry.valueString.trim() !== '') {
    return entry.valueString.trim();
  }

  if (typeof entry.valueCode === 'string' && entry.valueCode.trim() !== '') {
    return entry.valueCode.trim();
  }

  if (typeof entry.valueUri === 'string' && entry.valueUri.trim() !== '') {
    return entry.valueUri.trim();
  }

  if (typeof entry.valueId === 'string' && entry.valueId.trim() !== '') {
    return entry.valueId.trim();
  }

  const valueCoding = entry.valueCoding;
  if (valueCoding && typeof valueCoding === 'object') {
    const code = (valueCoding as Record<string, unknown>).code;
    if (typeof code === 'string' && code.trim() !== '') {
      return code.trim();
    }
  }

  const valueCodeableConcept = entry.valueCodeableConcept;
  if (valueCodeableConcept && typeof valueCodeableConcept === 'object') {
    const coding = (valueCodeableConcept as Record<string, unknown>).coding;
    if (Array.isArray(coding) && coding.length > 0) {
      const first = coding[0] as Record<string, unknown>;
      const code = first.code;
      if (typeof code === 'string' && code.trim() !== '') {
        return code.trim();
      }
    }
  }

  const valueIdentifier = entry.valueIdentifier;
  if (valueIdentifier && typeof valueIdentifier === 'object') {
    const value = (valueIdentifier as Record<string, unknown>).value;
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  const reference = entry.valueReference;
  if (reference && typeof reference === 'object') {
    const ref = reference as Record<string, unknown>;
    if (typeof ref.reference === 'string' && ref.reference.trim() !== '') {
      const parts = ref.reference.trim().split('/');
      return parts[parts.length - 1] || ref.reference.trim();
    }

    const identifier = ref.identifier;
    if (identifier && typeof identifier === 'object') {
      const value = (identifier as Record<string, unknown>).value;
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
  }

  return undefined;
}

function readExtensionValueEntries(
  entry: Record<string, unknown>,
): string[] {
  if (Array.isArray(entry.valueString)) {
    return normalizeStringArray(entry.valueString);
  }

  const scalar = readExtensionScalarValue(entry);
  if (scalar) {
    return [scalar];
  }

  return normalizeStringArray(entry.value);
}

function isUserRoleExtensionUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.trim() === '') {
    return false;
  }

  const lastSegment = url
    .trim()
    .split('/')
    .pop()
    ?.toLowerCase()
    .replace(/_/g, '-');

  return lastSegment === 'userrole' || lastSegment === 'user-role';
}

function readUserRoleFromExtensions(extensions: unknown): string[] {
  if (!Array.isArray(extensions)) {
    return [];
  }

  const values: string[] = [];
  for (const extension of extensions) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }

    const entry = extension as Record<string, unknown>;
    if (isUserRoleExtensionUrl(entry.url)) {
      values.push(...readExtensionValueEntries(entry));
    }

    values.push(...readUserRoleFromExtensions(entry.extension));
  }

  return values;
}

function readExtensionValues(
  extensions: unknown,
  url: string,
): string[] {
  if (!Array.isArray(extensions)) {
    return [];
  }

  const values: string[] = [];
  for (const extension of extensions) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    const entry = extension as Record<string, unknown>;
    if (!extensionUrlMatches(entry.url, url)) {
      continue;
    }

    const entries = readExtensionValueEntries(entry);
    if (entries.length > 0) {
      values.push(...entries);
      continue;
    }

    const nested = readExtensionValues(entry.extension, url);
    values.push(...nested);
  }

  return values;
}

function extractRoleIdsFromIdentifiers(identifiers: unknown): string[] {
  if (!Array.isArray(identifiers)) {
    return [];
  }

  const roles: string[] = [];
  for (const identifier of identifiers) {
    if (!identifier || typeof identifier !== 'object') {
      continue;
    }

    const entry = identifier as Record<string, unknown>;
    const system =
      typeof entry.system === 'string' ? entry.system.trim() : '';
    const matchesRoleSystem =
      USER_ROLE_IDENTIFIER_SYSTEMS.has(system) ||
      system.endsWith('/user-role') ||
      system.endsWith('/userRole');

    if (!matchesRoleSystem) {
      continue;
    }

    const value = typeof entry.value === 'string' ? entry.value.trim() : '';
    if (value) {
      roles.push(value);
    }
  }

  return roles;
}

function extractAddress(addresses: unknown): Record<string, string> | undefined {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return undefined;
  }

  const address = addresses[0] as Record<string, unknown>;
  const line = Array.isArray(address.line)
    ? address.line.map(String).filter(Boolean)
    : [];

  return {
    address: line[0] ?? '',
    city: String(address.city ?? ''),
    state: String(address.state ?? ''),
    country: String(address.country ?? ''),
    postalCode: String(address.postalCode ?? ''),
  };
}

function extractPhotoUrl(photo: unknown): string | undefined {
  if (!Array.isArray(photo) || photo.length === 0) {
    return undefined;
  }

  const first = photo[0] as Record<string, unknown>;
  const url = typeof first.url === 'string' ? first.url.trim() : '';
  return url || undefined;
}

function defaultUserType(resourceType: string): string {
  return resourceType === 'Practitioner' ? 'STAFF' : 'USER';
}

function asRecord(value: unknown): AnyObject | undefined {
  return value && typeof value === 'object' ? (value as AnyObject) : undefined;
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
    const system =
      typeof item.system === 'string' ? item.system.trim().toLowerCase() : '';
    const value =
      typeof item.value === 'string' ? item.value.trim() : '';
    if (!value) {
      continue;
    }
    if (system === 'email' || (!system && looksLikeEmail(value))) {
      email = value;
    } else if (system === 'phone' || (!system && !looksLikeEmail(value))) {
      phone = value;
    }
  }

  return { email, phone };
}

function readManagingOrganizationId(resource: AnyObject): string | undefined {
  const reference = asRecord(resource.managingOrganization)?.reference;
  if (typeof reference !== 'string' || reference.trim() === '') {
    return undefined;
  }
  const parts = reference.trim().split('/');
  return parts[parts.length - 1] || reference.trim();
}

function collectExtensions(...sources: Array<AnyObject | undefined>): unknown[] {
  const extensions: unknown[] = [];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    if (Array.isArray(source.extension)) {
      extensions.push(...source.extension);
    }
    if (Array.isArray(source.modifierExtension)) {
      extensions.push(...source.modifierExtension);
    }
  }
  return extensions;
}

function extractEmergencyContact(
  contacts: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return undefined;
  }

  const entry = asRecord(contacts[0]);
  if (!entry) {
    return undefined;
  }

  const relationshipEntry = Array.isArray(entry.relationship)
    ? asRecord(entry.relationship[0])
    : undefined;
  const relationship =
    typeof relationshipEntry?.text === 'string'
      ? relationshipEntry.text.trim()
      : undefined;
  const name =
    typeof asRecord(entry.name)?.text === 'string'
      ? String(asRecord(entry.name)?.text).trim()
      : undefined;
  const telecom = parseTelecom(entry);

  return Object.fromEntries(
    Object.entries({
      relationship,
      name,
      phone: telecom.phone,
      email: telecom.email,
    }).filter(([, value]) => value !== undefined && value !== ''),
  );
}

function mergePassthroughFromResource(
  target: AnyObject,
  resource: Record<string, unknown>,
): void {
  const nestedUserInfo =
    resource.userInfo && typeof resource.userInfo === 'object'
      ? (resource.userInfo as Record<string, unknown>)
      : undefined;

  if (target.userRole === undefined && resource.userRole !== undefined) {
    target.userRole = resource.userRole ?? nestedUserInfo?.userRole;
  }
  if (target.userType === undefined && resource.userType !== undefined) {
    target.userType = resource.userType ?? nestedUserInfo?.userType;
  }
  if (
    target.organizationID === undefined &&
    resource.organizationID !== undefined
  ) {
    target.organizationID =
      resource.organizationID ?? nestedUserInfo?.organizationID;
  }
  if (target.profilePic === undefined && resource.profilePic !== undefined) {
    target.profilePic = resource.profilePic ?? nestedUserInfo?.profilePic;
  }
}

function pickFirstStringArray(...candidates: string[][]): string[] | undefined {
  for (const candidate of candidates) {
    if (candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function pickFirstString(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return undefined;
}

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

export function resolveCreateUserInboundHints(
  req: LambdaRequest,
  rawBody: Record<string, unknown>,
): CreateUserInboundHints {
  const userInfo =
    rawBody.userInfo && typeof rawBody.userInfo === 'object'
      ? (rawBody.userInfo as Record<string, unknown>)
      : undefined;

  const passthrough: AnyObject = {
    userRole: rawBody.userRole ?? userInfo?.userRole,
    userType: rawBody.userType ?? userInfo?.userType,
    organizationID: rawBody.organizationID ?? userInfo?.organizationID,
    profilePic: rawBody.profilePic ?? userInfo?.profilePic,
  };

  if (rawBody.resourceType === 'Bundle' && Array.isArray(rawBody.entry)) {
    for (const entry of rawBody.entry) {
      const resource = (entry as { resource?: unknown }).resource;
      if (resource && typeof resource === 'object') {
        mergePassthroughFromResource(
          passthrough,
          resource as Record<string, unknown>,
        );
      }
    }
  }

  return {
    passthrough,
    headerUserRole: normalizeStringArray(
      getHeader(req, 'x-user-role') ?? getHeader(req, 'x-user-roles'),
    ),
    queryUserRole: normalizeStringArray(
      req.query?.userRole ??
        req.params?.userRole ??
        req.event?.queryStringParameters?.userRole,
    ),
  };
}

/**
 * Shapes reverse-mapped FHIR output into the create-user API contract.
 */
export function enrichCreateUserCanonical(
  fhirResource: AnyObject,
  canonical: AnyObject,
  resourceType: string,
  hints: CreateUserInboundHints = {},
  bundleRoot?: AnyObject,
): AnyObject {
  const extensions = collectExtensions(fhirResource, bundleRoot);
  const extensionUserType = readExtensionValues(
    extensions,
    CREATE_USER_EXTENSION_URLS.userType,
  )[0];
  const extensionRoles = readUserRoleFromExtensions(extensions);
  const extensionOrganizationId = readExtensionValues(
    extensions,
    CREATE_USER_EXTENSION_URLS.organizationID,
  )[0];
  const extensionProfilePic = readExtensionValues(
    extensions,
    CREATE_USER_EXTENSION_URLS.profilePic,
  )[0];

  const passthrough = hints.passthrough ?? {};
  const userInfo = {
    ...(canonical.userInfo as AnyObject | undefined),
  };
  const contact = {
    ...(userInfo.contact as AnyObject | undefined),
  };
  const address = extractAddress(fhirResource.address);

  if (address) {
    contact.address = address;
  }

  const telecom = parseTelecom(fhirResource);
  const canonicalUserInfo = asRecord(canonical.userInfo);
  const email = pickEmail(
    telecom.email,
    contact.email,
    canonical.emailAddress,
    canonicalUserInfo?.emailAddress,
  );
  const phone = pickPhone(
    telecom.phone,
    contact.phone,
    canonical.phoneNumber,
    canonicalUserInfo?.phoneNumber,
  );
  if (email) {
    contact.email = email;
  } else if (
    typeof contact.email === 'string' &&
    contact.email.trim() !== '' &&
    !looksLikeEmail(contact.email)
  ) {
    delete contact.email;
  }
  if (phone) {
    contact.phone = phone;
  }

  const photoUrl = extractPhotoUrl(fhirResource.photo);
  if (photoUrl) {
    userInfo.profilePic = photoUrl;
  }
  if (extensionProfilePic) {
    userInfo.profilePic = extensionProfilePic;
  }

  userInfo.contact = contact;

  const emergencyContact = extractEmergencyContact(fhirResource.contact);
  if (emergencyContact && Object.keys(emergencyContact).length > 0) {
    userInfo.emergencyContact = emergencyContact;
  }

  if (typeof fhirResource.gender === 'string' && fhirResource.gender.trim() !== '') {
    userInfo.gender = fhirResource.gender.trim();
  }
  if (
    typeof fhirResource.birthDate === 'string' &&
    fhirResource.birthDate.trim() !== ''
  ) {
    userInfo.dateOfBirth = fhirResource.birthDate.trim();
  }

  const nameText =
    typeof userInfo.name === 'string' && userInfo.name.trim() !== ''
      ? userInfo.name.trim()
      : undefined;
  if (!nameText) {
    const names = fhirResource.name;
    if (Array.isArray(names) && names.length > 0) {
      const name = names[0] as AnyObject;
      if (typeof name.text === 'string' && name.text.trim() !== '') {
        userInfo.name = name.text.trim();
      } else {
        const given = Array.isArray(name.given)
          ? name.given.map(String).filter(Boolean).join(' ')
          : '';
        const family = typeof name.family === 'string' ? name.family : '';
        const combined = [given, family].filter(Boolean).join(' ').trim();
        if (combined) {
          userInfo.name = combined;
        }
      }
    }
  }

  const userRole = pickFirstStringArray(
    extensionRoles,
    extractRoleIdsFromIdentifiers(fhirResource.identifier),
    normalizeStringArray(fhirResource.userRole),
    normalizeStringArray(
      (fhirResource.userInfo as AnyObject | undefined)?.userRole,
    ),
    normalizeStringArray(passthrough.userRole),
    hints.headerUserRole ?? [],
    hints.queryUserRole ?? [],
    Array.isArray(canonical.userRole)
      ? normalizeStringArray(canonical.userRole)
      : [],
    normalizeStringArray(
      (canonical.userInfo as AnyObject | undefined)?.userRole,
    ),
  );

  return {
    ...canonical,
    userInfo,
    userType:
      pickFirstString(
        extensionUserType,
        typeof passthrough.userType === 'string' ? passthrough.userType : undefined,
        typeof canonical.userType === 'string' ? canonical.userType : undefined,
        defaultUserType(resourceType),
      ) ?? defaultUserType(resourceType),
    userRole: userRole ?? [],
    organizationID: pickFirstString(
      extensionOrganizationId,
      readManagingOrganizationId(fhirResource),
      typeof fhirResource.organizationID === 'string'
        ? fhirResource.organizationID
        : undefined,
      typeof passthrough.organizationID === 'string'
        ? passthrough.organizationID
        : undefined,
      typeof canonical.organizationID === 'string'
        ? canonical.organizationID
        : undefined,
    ),
    profilePic: pickFirstString(
      extensionProfilePic,
      typeof passthrough.profilePic === 'string' ? passthrough.profilePic : undefined,
      typeof canonical.profilePic === 'string' ? canonical.profilePic : undefined,
      photoUrl,
    ),
  };
}
