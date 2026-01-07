/**
 * Helper Utilities for FHIR Gateway
 */

/**
 * Extract access token from request headers
 * Supports both 'Authorization' and 'authorization' header names
 */
export function getAccessTokenFromHeaders(
  headers: Record<string, string | undefined>
): string | undefined {
  const authHeader =
    headers.Authorization ||
    headers.authorization ||
    headers['X-Authorization'] ||
    headers['x-authorization'];

  if (!authHeader) {
    return undefined;
  }

  // Remove 'Bearer ' prefix if present
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return authHeader.trim();
}

