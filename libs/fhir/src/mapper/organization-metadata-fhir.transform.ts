import type { FhirCollectionBundle } from '../types/fhir-bundle';

import {
  buildOrgSettingsExtension,
  buildScheduleResource,
} from './organization-detail-fhir.transform';

const CATALOG_ORG_ID = 'org-metadata-catalog';
const ORG_STATUS_EXTENSION_URL =
  'http://your-system.org/fhir/StructureDefinition/org-status-list';
const ORG_SIZE_EXTENSION_URL =
  'http://your-system.org/fhir/StructureDefinition/org-size-tier';
const ORG_CUSTOM_METADATA_EXTENSION_URL =
  'http://your-system.org/fhir/StructureDefinition/org-custom-metadata';

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

function extractSupportedVitals(
  supportedVitals: unknown,
): Array<{ id: string; displayName: string }> {
  const rows: Array<{ id: string; displayName: string }> = [];
  const source = Array.isArray(supportedVitals)
    ? supportedVitals
    : supportedVitals != null && typeof supportedVitals === 'object'
      ? [supportedVitals]
      : [];

  for (const item of source) {
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

function buildCatalogOrganization(payload: AnyRecord): Record<string, unknown> {
  const orgStatus = Array.isArray(payload.orgStatus)
    ? payload.orgStatus.filter((s): s is string => typeof s === 'string')
    : [];

  const statusExtensions = orgStatus.map((status) => ({
    url: 'status',
    valueCode: status,
  }));

  const orgSizeExtensions = (Array.isArray(payload.orgSize) ? payload.orgSize : [])
    .map((size, index) => {
      const record = asRecord(size);
      if (!record) {
        return undefined;
      }
      const value = pickString(record.value);
      const nested: Array<Record<string, unknown>> = [];
      if (value) {
        nested.push({ url: 'value', valueString: value });
      }
      if (typeof record.min === 'number') {
        nested.push({ url: 'min', valueInteger: record.min });
      }
      if (typeof record.max === 'number') {
        nested.push({ url: 'max', valueInteger: record.max });
      }
      if (nested.length === 0) {
        return undefined;
      }
      return {
        url: `tier-${index + 1}`,
        extension: nested,
      };
    })
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);

  const extensions: Array<Record<string, unknown>> = [];
  if (statusExtensions.length > 0) {
    extensions.push({
      url: ORG_STATUS_EXTENSION_URL,
      extension: statusExtensions,
    });
  }
  if (orgSizeExtensions.length > 0) {
    extensions.push({
      url: ORG_SIZE_EXTENSION_URL,
      extension: orgSizeExtensions,
    });
  }

  const settingsExtension = buildOrgSettingsExtension(
    asRecord(payload.defaultSetting),
  );
  if (settingsExtension) {
    extensions.push(...settingsExtension);
  }

  return Object.fromEntries(
    Object.entries({
      resourceType: 'Organization',
      id: CATALOG_ORG_ID,
      name: 'Organization Metadata Catalog',
      extension: extensions.length > 0 ? extensions : undefined,
    }).filter(([, value]) => value !== undefined),
  );
}

function buildOrgTypeOrganization(
  orgType: AnyRecord,
): Record<string, unknown> | undefined {
  const orgTypeId = pickString(orgType.orgTypeId);
  const name = pickString(orgType.name);
  if (!orgTypeId || !name) {
    return undefined;
  }

  return {
    resourceType: 'Organization',
    id: orgTypeId,
    name,
    partOf: { reference: `Organization/${CATALOG_ORG_ID}` },
    type: [{ text: name }],
  };
}

function extractCodeSystemConcepts(value: unknown): Array<{ code: string; display: string }> {
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const concepts: Array<{ code: string; display: string }> = [];
  for (const [key, entry] of Object.entries(record)) {
    const item = asRecord(entry);
    const code = pickString(item?.id, item?.code, key) ?? key;
    const display = pickString(item?.name, item?.displayName, item?.display, key) ?? key;
    concepts.push({ code, display });
  }
  return concepts;
}

function buildCodeSystemResource(
  id: string,
  title: string,
  concepts: Array<{ code: string; display: string }>,
): Record<string, unknown> | undefined {
  if (concepts.length === 0) {
    return undefined;
  }

  return {
    resourceType: 'CodeSystem',
    id,
    name: title,
    status: 'active',
    content: 'complete',
    concept: concepts.map((concept) => ({
      code: concept.code,
      display: concept.display,
    })),
  };
}

function buildPermissionsListResource(items: unknown[]): Record<string, unknown> | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return {
    resourceType: 'List',
    id: 'org-permissions',
    status: 'current',
    mode: 'working',
    entry: items.map((item, index) => ({
      item: {
        display:
          typeof item === 'string'
            ? item
            : JSON.stringify(item),
      },
      flag: { text: `permission-${index + 1}` },
    })),
  };
}

function buildPerOrganizationMetadataResource(
  payload: AnyRecord,
): Record<string, unknown> | undefined {
  const orgId = pickString(payload.organizationId, payload.organizationID);
  if (!orgId || payload.metadata == null) {
    return undefined;
  }

  const extensions: Array<Record<string, unknown>> = [
    {
      url: ORG_CUSTOM_METADATA_EXTENSION_URL,
      valueString: JSON.stringify(payload.metadata),
    },
  ];

  const updatedAt = pickString(payload.updatedAt);
  if (updatedAt) {
    extensions.push({ url: 'updatedAt', valueDateTime: updatedAt });
  }
  if (typeof payload.version === 'number') {
    extensions.push({ url: 'version', valueInteger: payload.version });
  }

  return {
    resourceType: 'Organization',
    id: orgId,
    extension: extensions,
  };
}

/**
 * Projects canonical organization metadata API payloads into a FHIR collection Bundle.
 */
export function transformOrganizationMetadataToFhirBundle(
  canonical: unknown,
): FhirCollectionBundle | undefined {
  const payload = asRecord(canonical);
  if (!payload) {
    return undefined;
  }

  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];

  const perOrgResource = buildPerOrganizationMetadataResource(payload);
  if (perOrgResource) {
    entries.push(bundleEntry(perOrgResource));
    return {
      resourceType: 'Bundle',
      type: 'collection',
      id: `bundle-${perOrgResource.id}`,
      entry: entries,
    };
  }

  entries.push(bundleEntry(buildCatalogOrganization(payload)));

  const orgTypes = Array.isArray(payload.orgTypes) ? payload.orgTypes : [];
  for (const orgType of orgTypes) {
    const resource = buildOrgTypeOrganization(asRecord(orgType) ?? {});
    if (resource) {
      entries.push(bundleEntry(resource));
    }
  }

  const schedule = buildScheduleResource(
    CATALOG_ORG_ID,
    asRecord(payload.scheduleConf),
  );
  if (schedule) {
    entries.push(bundleEntry(schedule));
  }

  for (const vital of extractSupportedVitals(payload.supportedVitals)) {
    entries.push(bundleEntry(buildObservationDefinitionResource(vital)));
  }

  const relations = buildCodeSystemResource(
    'supported-relations',
    'Supported Relations',
    extractCodeSystemConcepts(payload.supportedRelations),
  );
  if (relations) {
    entries.push(bundleEntry(relations));
  }

  const specialty = buildCodeSystemResource(
    'supported-specialty',
    'Supported Specialty',
    extractCodeSystemConcepts(payload.supportedSpecialty),
  );
  if (specialty) {
    entries.push(bundleEntry(specialty));
  }

  const permissions = buildPermissionsListResource(
    Array.isArray(payload.items) ? payload.items : [],
  );
  if (permissions) {
    entries.push(bundleEntry(permissions));
  }

  if (entries.length === 0) {
    return undefined;
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    id: 'bundle-org-metadata',
    entry: entries,
  };
}
