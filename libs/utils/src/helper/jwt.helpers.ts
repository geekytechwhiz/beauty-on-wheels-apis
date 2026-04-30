import { DEFAULT_PASSWORD } from "../constants/constants";

/** Strips a leading `Bearer` prefix (case-insensitive) from an Authorization header value. */
export function stripBearerFromAuthHeader(header: string): string {
  return header.replace(/^\s*Bearer\s+/i, '').trim();
}

/**
 * Reads organization / tenant id from common Cognito and custom JWT claim shapes.
 */
export function pickOrganizationIdFromJwtPayload(decoded: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [
    decoded['custom:organizationID'],
    decoded['custom:organizationId'],
    decoded.organizationID,
    decoded.organizationId,
    decoded.tenantId,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim() !== '') {
      return v.trim();
    }
  }
  return undefined;
}

export const decodeJwtPayload = (authHeader: string) => {
  try {
    const jwt = stripBearerFromAuthHeader(authHeader);

    const base64Url = jwt.split('.')[1];
    if (base64Url == null) {
      return {} as Record<string, unknown>;
    }

    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

    const payload = Buffer.from(base64, 'base64').toString();

    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
};
 
  export const generatePassword = (): string => {
    // return `Comm@n12${Math.random().toString(36).substring(5)}`;
    return DEFAULT_PASSWORD;
  };