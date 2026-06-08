type ValidationIssue = { field?: string; message: string };

const LEGACY_FLAT_KEYS = [
  'fullName',
  'emailAddress',
  'phoneNumber',
  'phoneCode',
  'firstName',
  'lastName',
] as const;

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function objectKeys(value: unknown): string[] {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).sort();
}

/** Structural summary only — no contact values or PII. */
export function summarizeCreateUserValidationPayload(
  payload: Record<string, unknown>,
  req?: { context?: Record<string, unknown>; event?: { headers?: Record<string, unknown> } },
): Record<string, unknown> {
  const userInfo = payload.userInfo;
  const contact =
    userInfo != null && typeof userInfo === 'object' && !Array.isArray(userInfo)
      ? (userInfo as Record<string, unknown>).contact
      : undefined;
  const headers = req?.event?.headers;
  const ctx = req?.context;

  return {
    topLevelKeys: objectKeys(payload),
    bodyEmpty: objectKeys(payload).length === 0,
    hasUserInfo: userInfo != null && typeof userInfo === 'object' && !Array.isArray(userInfo),
    userInfoKeys: objectKeys(userInfo),
    hasContact: contact != null && typeof contact === 'object' && !Array.isArray(contact),
    contactKeys: objectKeys(contact),
    hasFlatLegacyFields: LEGACY_FLAT_KEYS.some((key) => key in payload),
    hasUserRole: payload.userRole != null,
    userRoleType: Array.isArray(payload.userRole)
      ? 'array'
      : payload.userRole == null
        ? 'missing'
        : typeof payload.userRole,
    hasUserType: typeof payload.userType === 'string' && payload.userType.trim() !== '',
    hasOrganizationID:
      typeof payload.organizationID === 'string' && payload.organizationID.trim() !== '',
    bodyResourceType:
      typeof payload.resourceType === 'string' ? payload.resourceType : undefined,
    inboundFhirResource: Boolean(ctx?.inboundFhirResource),
    fhirResourceType:
      typeof ctx?.fhirResourceType === 'string' ? ctx.fhirResourceType : undefined,
    acceptHeader: headerValue(headers, 'Accept'),
    contentTypeHeader: headerValue(headers, 'Content-Type'),
  };
}

export function logCreateUserValidationFailure(
  req: {
    context?: Record<string, unknown> & { correlationId?: string; logger?: unknown };
    event?: { headers?: Record<string, unknown> };
  },
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  log: { warn: (entry: Record<string, unknown>) => void },
): void {
  log.warn({
    event: 'createUser_validation_failed',
    validationIssues: issues.map((issue) => ({
      field: issue.field ?? '',
      message: issue.message,
    })),
    payloadShape: summarizeCreateUserValidationPayload(payload, req),
  });
}
