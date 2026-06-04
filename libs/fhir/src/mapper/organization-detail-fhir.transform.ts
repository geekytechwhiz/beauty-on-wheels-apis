import type { FhirCollectionBundle } from '../types/fhir-bundle';

const ORG_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/organization-type';
const ORG_SETTINGS_EXTENSION_URL =
  'http://your-system.org/fhir/StructureDefinition/org-settings';

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | undefined {
  return value && typeof value === 'object' ? (value as AnyRecord) : undefined;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function formatTelecomValue(phoneCode?: string, phoneNumber?: string): string | undefined {
  const code = phoneCode?.trim() ?? '';
  const number = phoneNumber?.trim() ?? '';
  if (!number) {
    return undefined;
  }
  if (code) {
    const normalizedCode = code.startsWith('+') ? code : `+${code.replace(/^\+/, '')}`;
    const normalizedNumber = number.replace(/\s+/g, '');
    return `${normalizedCode}${normalizedNumber}`;
  }
  return number;
}

function mapOrganizationTypeCoding(
  organizationType?: string,
): Array<Record<string, unknown>> | undefined {
  if (!organizationType) {
    return undefined;
  }

  const normalized = organizationType.trim().toUpperCase();
  const hospitalLike = new Set(['HOSPITAL', 'CLINIC', 'PHARMACY', 'PROV']);

  if (hospitalLike.has(normalized)) {
    return [
      {
        coding: [
          {
            system: ORG_TYPE_SYSTEM,
            code: 'prov',
            display: 'Healthcare Provider',
          },
        ],
      },
    ];
  }

  return [{ text: organizationType }];
}

function buildAddressLine(address?: AnyRecord): string[] | undefined {
  const line = pickString(address?.address);
  return line ? [line] : undefined;
}

function joinAddressText(address?: AnyRecord): string | undefined {
  if (!address) {
    return undefined;
  }
  const parts = [
    address.address,
    address.city,
    address.state,
    address.country,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function buildOrgSettingsExtension(
  defaultSetting?: AnyRecord,
): Array<Record<string, unknown>> | undefined {
  if (!defaultSetting) {
    return undefined;
  }

  const nested: Array<Record<string, unknown>> = [];
  const chatExpire = defaultSetting.chatSessionExpireAfter ?? defaultSetting.chat_session_expire_after;
  const missedReminder = defaultSetting.missedReminderAfter ?? defaultSetting.missed_reminder_after;
  const notifications = asRecord(defaultSetting.notifications);

  if (typeof chatExpire === 'number') {
    nested.push({ url: 'chatSessionExpireAfter', valueInteger: chatExpire });
  }
  if (typeof missedReminder === 'number') {
    nested.push({ url: 'missedReminderAfter', valueInteger: missedReminder });
  }
  if (notifications) {
    const notificationNested: Array<Record<string, unknown>> = [];
    for (const [key, value] of Object.entries(notifications)) {
      if (typeof value === 'boolean') {
        notificationNested.push({ url: key, valueBoolean: value });
      }
    }
    if (notificationNested.length > 0) {
      nested.push({ url: 'notifications', extension: notificationNested });
    }
  }

  if (nested.length === 0) {
    return undefined;
  }

  return [
    {
      url: ORG_SETTINGS_EXTENSION_URL,
      extension: nested,
    },
  ];
}

function buildOrganizationResource(
  payload: AnyRecord,
  orgId: string,
  orgInfo: AnyRecord | undefined,
): Record<string, unknown> {
  const address = asRecord(orgInfo?.address);
  const phone = formatTelecomValue(
    pickString(orgInfo?.phoneCode),
    pickString(orgInfo?.phoneNumber),
  );
  const email = pickString(orgInfo?.emailAddress);
  const telecom: Array<Record<string, unknown>> = [];

  if (phone) {
    telecom.push({ system: 'phone', value: phone });
  }
  if (email) {
    telecom.push({ system: 'email', value: email });
  }

  const resource: Record<string, unknown> = {
    resourceType: 'Organization',
    id: orgId,
    name: pickString(orgInfo?.organizationName, orgInfo?.name),
    type: mapOrganizationTypeCoding(pickString(orgInfo?.organizationType)),
    telecom: telecom.length > 0 ? telecom : undefined,
    address: address
      ? [
          {
            line: buildAddressLine(address),
            city: pickString(address.city),
            state: pickString(address.state),
            postalCode: pickString(address.postalCode),
            country: pickString(address.country),
          },
        ]
      : undefined,
    extension: buildOrgSettingsExtension(asRecord(orgInfo?.defaultSetting)),
  };

  return Object.fromEntries(
    Object.entries(resource).filter(([, value]) => value !== undefined),
  );
}

function buildPractitionerResource(admin: AnyRecord): Record<string, unknown> | undefined {
  const adminId = pickString(admin.adminId);
  if (!adminId) {
    return undefined;
  }

  const nameText = pickString(admin.adminName);
  const prefix = pickString(admin.namePrefix);
  const phone = formatTelecomValue(
    pickString(admin.phoneCode),
    pickString(admin.phoneNumber),
  );
  const email = pickString(admin.emailAddress);
  const telecom: Array<Record<string, unknown>> = [];

  if (phone) {
    telecom.push({ system: 'phone', value: phone });
  }
  if (email) {
    telecom.push({ system: 'email', value: email });
  }

  const addressText = joinAddressText(asRecord(admin.adminAddress));

  return Object.fromEntries(
    Object.entries({
      resourceType: 'Practitioner',
      id: adminId,
      name: nameText
        ? [
            {
              ...(prefix ? { prefix: [prefix] } : {}),
              text: nameText,
            },
          ]
        : undefined,
      telecom: telecom.length > 0 ? telecom : undefined,
      address: addressText ? [{ text: addressText }] : undefined,
    }).filter(([, value]) => value !== undefined),
  );
}

function buildPractitionerRoleResource(
  adminId: string,
  orgId: string,
  roleName?: string,
): Record<string, unknown> {
  return {
    resourceType: 'PractitionerRole',
    id: 'admin-role',
    practitioner: { reference: `Practitioner/${adminId}` },
    organization: { reference: `Organization/${orgId}` },
    code: roleName ? [{ text: roleName }] : undefined,
  };
}

function buildLinkedOrganizationResource(
  linked: AnyRecord,
  parentOrgId: string,
): Record<string, unknown> | undefined {
  const linkedId = pickString(linked.organizationId, linked.organizationID);
  if (!linkedId) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries({
      resourceType: 'Organization',
      id: linkedId,
      name: pickString(linked.name, linked.organizationName),
      partOf: { reference: `Organization/${parentOrgId}` },
    }).filter(([, value]) => value !== undefined),
  );
}

function parseTimeToIsoDate(year: number, time: string, month = 1, day = 1): string {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  const hh = String(hour ?? 9).padStart(2, '0');
  const mm = String(minute ?? 0).padStart(2, '0');
  const mo = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mo}-${dd}T${hh}:${mm}:00+05:30`;
}

function buildScheduleResource(
  orgId: string,
  scheduleConf?: AnyRecord,
): Record<string, unknown> | undefined {
  if (!scheduleConf) {
    return undefined;
  }

  const year = new Date().getFullYear();
  const availability = Array.isArray(scheduleConf.availability)
    ? scheduleConf.availability
    : [];

  let start = parseTimeToIsoDate(year, '09:00');
  let end = parseTimeToIsoDate(year, '18:00', 12, 31);

  for (const dayEntry of availability) {
    const day = asRecord(dayEntry);
    if (!day?.available || !Array.isArray(day.availableHours)) {
      continue;
    }
    for (const slot of day.availableHours) {
      const hours = asRecord(slot);
      const from = pickString(hours?.from);
      const to = pickString(hours?.to);
      if (from) {
        start = parseTimeToIsoDate(year, from);
      }
      if (to) {
        end = parseTimeToIsoDate(year, to, 12, 31);
      }
    }
  }

  return {
    resourceType: 'Schedule',
    id: `schedule-${orgId}`,
    actor: [{ reference: `Organization/${orgId}` }],
    planningHorizon: { start, end },
  };
}

function extractSupportedVitals(
  supportedVitals: unknown,
): Array<{ id: string; displayName: string }> {
  if (!Array.isArray(supportedVitals)) {
    return [];
  }

  const rows: Array<{ id: string; displayName: string }> = [];

  for (const item of supportedVitals) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    for (const [key, value] of Object.entries(record)) {
      const vital = asRecord(value);
      const code = pickString(vital?.code, key) ?? key;
      rows.push({
        id: toKebabCase(code),
        displayName: pickString(vital?.displayName, key) ?? key,
      });
    }
  }

  return rows;
}

function buildObservationDefinitionResource(
  vital: { id: string; displayName: string },
): Record<string, unknown> {
  return {
    resourceType: 'ObservationDefinition',
    id: vital.id,
    code: { text: vital.displayName },
    category: [{ text: 'vital-signs' }],
  };
}

function bundleEntry(resource: Record<string, unknown>): {
  fullUrl: string;
  resource: Record<string, unknown>;
} {
  const resourceType = String(resource.resourceType ?? 'Resource');
  const id = pickString(resource.id);
  return {
    fullUrl: id ? `${resourceType}/${id}` : `urn:uuid:${resourceType}`,
    resource,
  };
}

function resolveOrganizationId(payload: AnyRecord): string | undefined {
  const orgInfo = asRecord(payload.organizationInfo);
  return pickString(
    orgInfo?.organizationID,
    orgInfo?.organizationId,
    payload.accountAlias,
    payload.organizationID,
    payload.organizationId,
  );
}

/**
 * Projects a canonical getOrganization payload into a multi-resource FHIR collection Bundle.
 */
export function transformOrganizationDetailToFhirBundle(
  canonical: unknown,
): FhirCollectionBundle | undefined {
  const payload = asRecord(canonical);
  if (!payload) {
    return undefined;
  }

  const orgId = resolveOrganizationId(payload);
  if (!orgId) {
    return undefined;
  }

  const orgInfo = asRecord(payload.organizationInfo);
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];

  entries.push(
    bundleEntry(buildOrganizationResource(payload, orgId, orgInfo)),
  );

  const admin = asRecord(payload.adminDetails);
  const adminId = admin ? pickString(admin.adminId) : undefined;
  if (admin && adminId) {
    const practitioner = buildPractitionerResource(admin);
    if (practitioner) {
      entries.push(bundleEntry(practitioner));
      entries.push(
        bundleEntry(
          buildPractitionerRoleResource(
            adminId,
            orgId,
            pickString(admin.roleName, admin.adminRole),
          ),
        ),
      );
    }
  }

  const linkedOrganizations = Array.isArray(payload.linkedOrganizations)
    ? payload.linkedOrganizations
    : [];
  for (const linked of linkedOrganizations) {
    const linkedResource = buildLinkedOrganizationResource(
      asRecord(linked) ?? {},
      orgId,
    );
    if (linkedResource) {
      entries.push(bundleEntry(linkedResource));
    }
  }

  const schedule = buildScheduleResource(orgId, asRecord(orgInfo?.scheduleConf));
  if (schedule) {
    entries.push(bundleEntry(schedule));
  }

  for (const vital of extractSupportedVitals(payload.supportedVitals)) {
    entries.push(bundleEntry(buildObservationDefinitionResource(vital)));
  }

  if (entries.length === 0) {
    return undefined;
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    id: `bundle-${orgId}`,
    entry: entries,
  };
}
