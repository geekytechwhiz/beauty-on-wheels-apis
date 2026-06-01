/**
 * Maps persisted user / API user payloads to a FHIR resource type for the optional FHIR response layer.
 */
export function inferFhirResourceTypeForUser(
  user: unknown
): 'Patient' | 'Practitioner' | undefined {
  if (!user || typeof user !== 'object') {
    return undefined;
  }
  const u = user as Record<string, unknown>;
  const hasUserIdentity =
    (typeof u.userID === 'string' && u.userID.trim() !== '') ||
    (typeof u.userId === 'string' && u.userId.trim() !== '') ||
    (typeof u.patientId === 'string' && u.patientId.trim() !== '') ||
    (typeof u.id === 'string' && u.id.trim() !== '');
  const looksLikeUserPayload =
    hasUserIdentity ||
    typeof u.emailAddress === 'string' ||
    typeof u.firstName === 'string' ||
    typeof u.lastName === 'string' ||
    typeof u.roleName === 'string' ||
    typeof u.userType === 'string';
  if (!looksLikeUserPayload) {
    return undefined;
  }
  const userType = String(u.userType ?? '').trim().toUpperCase();
  const roleName = String(u.roleName ?? u.definedRoleCode ?? '').trim().toUpperCase();

  if (userType === 'STAFF') {
    return 'Practitioner';
  }
  if (roleName === 'PATIENT') {
    return 'Patient';
  }
  const practitionerRoles = new Set([
    'DOCTOR',
    'PHYSICIAN',
    'NURSE',
    'SURGEON',
    'PATHOLOGIST',
    'PHARMACIST',
    'RADIOLOGIST',
    'THERAPIST',
    'DIETICIAN',
    'DIETITIAN',
  ]);
  if (practitionerRoles.has(roleName)) {
    return 'Practitioner';
  }
  return 'Patient';
}
