/**
 * Maps organization API payloads to FHIR Organization for the optional FHIR response layer.
 */
export function inferFhirResourceTypeForOrganization(
  organization: unknown,
): 'Organization' | undefined {
  if (!organization || typeof organization !== 'object') {
    return undefined;
  }

  const o = organization as Record<string, unknown>;
  const orgInfo =
    o.organizationInfo && typeof o.organizationInfo === 'object'
      ? (o.organizationInfo as Record<string, unknown>)
      : undefined;

  const hasOrgIdentity =
    (typeof o.organizationId === 'string' && o.organizationId.trim() !== '') ||
    (typeof o.organizationID === 'string' && o.organizationID.trim() !== '') ||
    (typeof o.accountAlias === 'string' && o.accountAlias.trim() !== '') ||
    (typeof o.newOrganizationID === 'string' && o.newOrganizationID.trim() !== '') ||
    (typeof orgInfo?.organizationID === 'string' && orgInfo.organizationID.trim() !== '') ||
    (typeof orgInfo?.organizationId === 'string' && orgInfo.organizationId.trim() !== '');

  const hasOrgName =
    typeof o.organizationName === 'string' ||
    typeof o.orgName === 'string' ||
    typeof o.name === 'string' ||
    typeof orgInfo?.organizationName === 'string' ||
    typeof orgInfo?.name === 'string';

  if (!hasOrgIdentity && !hasOrgName) {
    return undefined;
  }

  return 'Organization';
}
