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

  return {
    passthrough: {
      userRole: rawBody.userRole ?? userInfo?.userRole,
      userType: rawBody.userType ?? userInfo?.userType,
      organizationID: rawBody.organizationID ?? userInfo?.organizationID,
      profilePic: rawBody.profilePic ?? userInfo?.profilePic,
    },
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
): AnyObject {
  const extensions = fhirResource.extension;
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

  const photoUrl = extractPhotoUrl(fhirResource.photo);
  if (photoUrl) {
    userInfo.profilePic = photoUrl;
  }
  if (extensionProfilePic) {
    userInfo.profilePic = extensionProfilePic;
  }

  userInfo.contact = contact;

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
    userRole,
    organizationID: pickFirstString(
      extensionOrganizationId,
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
