import type { MetadataValuesByTypesResultDto } from '@api-hub/service-clients';

import type { OrganizationConfigData } from '../models';
import type { OrganizationConfigMetadataDefaults } from '../models/Organization';
import type { OrgConfigMetadataReader } from './organizationConfig.validator';
import {
  CONFIG_FIELD_TO_METADATA_TYPE,
  ENRICHABLE_CONFIG_ARRAY_FIELDS,
  ENRICHABLE_CONFIG_SINGLE_FIELDS,
} from './organizationConfig.metadata-types';

/** Metadata types fetched read-time for org-config UI dropdown defaults (not persisted on CONFIG). */
export const ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES = [
  'Department',
  'ProgramType',
  'Specialty',
] as const;

const METADATA_TYPE_TO_DEFAULTS_KEY: Record<
  (typeof ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES)[number],
  keyof OrganizationConfigMetadataDefaults
> = {
  Department: 'department',
  ProgramType: 'programType',
  Specialty: 'specialty',
};

function collectMetadataTypesForConfig(config: OrganizationConfigData): string[] {
  const types = new Set<string>();
  for (const field of [...ENRICHABLE_CONFIG_SINGLE_FIELDS, ...ENRICHABLE_CONFIG_ARRAY_FIELDS]) {
    const value = config[field];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    types.add(CONFIG_FIELD_TO_METADATA_TYPE[field]);
  }
  return [...types];
}

/** Union of config-driven metadata types and fixed dropdown-default types for a single batch read. */
export function collectMetadataTypesForConfigRead(config: OrganizationConfigData): string[] {
  return [
    ...new Set([...collectMetadataTypesForConfig(config), ...ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES]),
  ];
}

function isActiveRegistryValue(status: string): boolean {
  return String(status).toLowerCase() === 'active';
}

/** Maps POST `/metadata/values/by-types` output into GET config `metadataDefaults`. */
export function mapMetadataDefaultsFromRegistry(
  result: MetadataValuesByTypesResultDto,
): OrganizationConfigMetadataDefaults {
  const itemsByType = new Map(result.items.map((item) => [item.metadataType, item]));

  const defaults = {} as OrganizationConfigMetadataDefaults;
  for (const metadataType of ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES) {
    const item = itemsByType.get(metadataType);
    const key = METADATA_TYPE_TO_DEFAULTS_KEY[metadataType];
    defaults[key] = (item?.values ?? [])
      .filter((value) => isActiveRegistryValue(value.status))
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((value) => ({
        valueCode: value.valueCode,
        label: value.label,
      }));
  }

  return defaults;
}

/** Fetches dropdown-default metadata when org config enrichment is skipped (no CONFIG body). */
export async function fetchOrganizationConfigMetadataDefaults(
  reader: OrgConfigMetadataReader,
  authHeader: string,
): Promise<OrganizationConfigMetadataDefaults | undefined> {
  try {
    const registryResult = await reader.getValuesByTypes(
      [...ORG_CONFIG_METADATA_DEFAULT_TYPE_CODES],
      authHeader,
    );
    return mapMetadataDefaultsFromRegistry(registryResult);
  } catch {
    return undefined;
  }
}
