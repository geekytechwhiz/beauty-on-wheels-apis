import type { MetadataValuesByTypesResultDto } from '@api-hub/service-clients';

import type {
  CategoryConditionGroup,
  CountryStateCityGroup,
  EnrichedOrganizationConfig,
  MetadataCodeLabel,
  OrganizationConfigData,
  OrganizationConfigMetadataDefaults,
} from '../models';
import type { OrgConfigMetadataReader } from './organizationConfig.validator';
import {
  collectMetadataTypesForConfigRead,
  mapMetadataDefaultsFromRegistry,
} from './organizationConfig.metadata-defaults';
import {
  CONFIG_FIELD_TO_METADATA_TYPE,
  ENRICHABLE_CONFIG_ARRAY_FIELDS,
  ENRICHABLE_CONFIG_SINGLE_FIELDS,
  type EnrichableConfigField,
} from './organizationConfig.metadata-types';

export type MetadataLabelLookup = Map<string, Map<string, string>>;

const normalizeCode = (value: string): string => value.trim().toUpperCase();

export function toMetadataCodeLabel(
  code: string,
  labelLookup: MetadataLabelLookup,
  metadataType: string,
): MetadataCodeLabel {
  const normalized = normalizeCode(code);
  const label = labelLookup.get(metadataType)?.get(normalized);
  return { code: normalized, label: label ?? normalized };
}

export function buildMetadataLabelLookup(result: MetadataValuesByTypesResultDto): MetadataLabelLookup {
  const lookup: MetadataLabelLookup = new Map();
  for (const item of result.items ?? []) {
    const typeMap = new Map<string, string>();
    for (const value of item.values ?? []) {
      typeMap.set(normalizeCode(value.valueCode), value.label);
    }
    lookup.set(item.metadataType, typeMap);
  }
  return lookup;
}

export function collectMetadataTypesForConfig(config: OrganizationConfigData): string[] {
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

export function enrichOrganizationConfigFields(
  config: OrganizationConfigData,
  labelLookup: MetadataLabelLookup,
): EnrichedOrganizationConfig {
  const enriched: EnrichedOrganizationConfig = {};

  if (config.timezone !== undefined) {
    enriched.timezone = config.timezone;
  }
  if (config.linkedOrgReferences !== undefined) {
    enriched.linkedOrgReferences = config.linkedOrgReferences;
  }
  if (config.requiredAgreementIds !== undefined) {
    enriched.requiredAgreementIds = config.requiredAgreementIds;
  }

  for (const field of ENRICHABLE_CONFIG_SINGLE_FIELDS) {
    const value = config[field];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    const metadataType = CONFIG_FIELD_TO_METADATA_TYPE[field];
    (enriched as Record<string, MetadataCodeLabel>)[field] = toMetadataCodeLabel(
      value,
      labelLookup,
      metadataType,
    );
  }

  for (const field of ENRICHABLE_CONFIG_ARRAY_FIELDS) {
    const values = config[field];
    if (!Array.isArray(values) || values.length === 0) continue;
    const metadataType = CONFIG_FIELD_TO_METADATA_TYPE[field as EnrichableConfigField];
    (enriched as Record<string, MetadataCodeLabel[]>)[field] = values.map((code) =>
      toMetadataCodeLabel(code, labelLookup, metadataType),
    );
  }

  return enriched;
}

export function deriveCountryStateCityGroup(
  config: OrganizationConfigData,
  labelLookup: MetadataLabelLookup,
): CountryStateCityGroup | undefined {
  const country = config.countryCode
    ? toMetadataCodeLabel(config.countryCode, labelLookup, CONFIG_FIELD_TO_METADATA_TYPE.countryCode)
    : undefined;
  const state = config.stateCode
    ? toMetadataCodeLabel(config.stateCode, labelLookup, CONFIG_FIELD_TO_METADATA_TYPE.stateCode)
    : undefined;
  const city = config.cityCode
    ? toMetadataCodeLabel(config.cityCode, labelLookup, CONFIG_FIELD_TO_METADATA_TYPE.cityCode)
    : undefined;

  if (!country && !state && !city) {
    return undefined;
  }

  return { ...(country ? { country } : {}), ...(state ? { state } : {}), ...(city ? { city } : {}) };
}

export async function deriveCategoryConditionGroups(
  config: OrganizationConfigData,
  labelLookup: MetadataLabelLookup,
  reader: OrgConfigMetadataReader,
  authHeader: string,
): Promise<CategoryConditionGroup[]> {
  const categoryCodes = (config.enabledCategoryCodes ?? []).map(normalizeCode).filter(Boolean);
  const enabledConditions = new Set(
    (config.enabledConditionCodes ?? []).map(normalizeCode).filter(Boolean),
  );

  if (categoryCodes.length === 0 || enabledConditions.size === 0) {
    return [];
  }

  const related = await reader.getRelatedValues(
    {
      fromType: 'Category',
      fromValues: categoryCodes,
      relationType: 'BELONGS_TO_CATEGORY',
      toType: 'Condition',
    },
    authHeader,
  );

  const groups: CategoryConditionGroup[] = [];
  for (const group of related.groups ?? []) {
    const categoryCode = normalizeCode(group.fromMetadataValueCode);
    if (!categoryCodes.includes(categoryCode)) continue;

    const conditions: MetadataCodeLabel[] = [];
    for (const relatedValue of group.values ?? []) {
      const conditionCode = normalizeCode(relatedValue.metadataValueCode);
      if (!enabledConditions.has(conditionCode)) continue;
      conditions.push({
        code: conditionCode,
        label:
          relatedValue.label?.trim() ||
          labelLookup.get('Condition')?.get(conditionCode) ||
          conditionCode,
      });
    }

    if (conditions.length === 0) continue;

    groups.push({
      category: {
        code: categoryCode,
        label: group.fromLabel?.trim() || labelLookup.get('Category')?.get(categoryCode) || categoryCode,
      },
      conditions,
    });
  }

  groups.sort((left, right) => left.category.code.localeCompare(right.category.code));
  return groups;
}

export async function enrichOrganizationConfig(
  config: OrganizationConfigData,
  options: {
    authHeader?: string;
    reader?: OrgConfigMetadataReader;
  } = {},
): Promise<{
  organizationConfig: EnrichedOrganizationConfig;
  enabledCategoryConditionGroups?: CategoryConditionGroup[];
  countryStateCityGroup?: CountryStateCityGroup;
  metadataDefaults?: OrganizationConfigMetadataDefaults;
}> {
  let labelLookup: MetadataLabelLookup = new Map();
  let metadataDefaults: OrganizationConfigMetadataDefaults | undefined;
  const authHeader = options.authHeader?.trim();
  const reader = options.reader;

  if (authHeader && reader) {
    const metadataTypes = collectMetadataTypesForConfigRead(config);
    try {
      const registryResult = await reader.getValuesByTypes(metadataTypes, authHeader);
      labelLookup = buildMetadataLabelLookup(registryResult);
      metadataDefaults = mapMetadataDefaultsFromRegistry(registryResult);
    } catch {
      labelLookup = new Map();
      metadataDefaults = undefined;
    }
  }

  const organizationConfig = enrichOrganizationConfigFields(config, labelLookup);
  const countryStateCityGroup = deriveCountryStateCityGroup(config, labelLookup);

  let enabledCategoryConditionGroups: CategoryConditionGroup[] | undefined;
  if (authHeader && reader) {
    try {
      const groups = await deriveCategoryConditionGroups(config, labelLookup, reader, authHeader);
      if (groups.length > 0) {
        enabledCategoryConditionGroups = groups;
      }
    } catch {
      enabledCategoryConditionGroups = undefined;
    }
  }

  return {
    organizationConfig,
    ...(countryStateCityGroup ? { countryStateCityGroup } : {}),
    ...(enabledCategoryConditionGroups ? { enabledCategoryConditionGroups } : {}),
    ...(metadataDefaults ? { metadataDefaults } : {}),
  };
}
