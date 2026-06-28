/** Resolves Authorization for metadata-registry calls (HTTP JWT or internal service token). */
export function resolveRegistryAuthHeader(authHeader?: string): string {
  const fromRequest = authHeader?.trim();
  if (fromRequest) {
    return fromRequest.toLowerCase().startsWith('bearer ') ? fromRequest : `Bearer ${fromRequest}`;
  }

  const internal = process.env.METADATA_REGISTRY_INTERNAL_AUTH_TOKEN?.trim();
  if (internal) {
    return internal.toLowerCase().startsWith('bearer ') ? internal : `Bearer ${internal}`;
  }

  return '';
}
