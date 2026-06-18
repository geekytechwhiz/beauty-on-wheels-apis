import type { MetadataValuesByTypesResultDto } from '@api-hub/service-clients';

import type {
  CategoryConditionGroup,
  CountryStateGroup,
  EnrichedOrganizationConfig,
  MetadataCodeLabel,
  OrganizationConfigData,
  OrganizationConfigRelationships,
  StateCityGroup,
} from '../models';
import type { OrgConfigMetadataReader } from './organizationConfig.validator';
import {
  CONFIG_FIELD_TO_METADATA_TYPE,
  ENRICHABLE_CONFIG_ARRAY_FIELDS,
  ENRICHABLE_CONFIG_SINGLE_FIELDS,
} from './organizationConfig.metadata-types';

export type MetadataLabelLookup = Map<string, Map<string, string>>;

const normalizeCode = (value: string): string => value.trim().toUpperCase();

export const EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS: OrganizationConfigRelationships = {
  categoryConditionGroups: [],
  countryStateGroups: [],
  stateCityGroups: [],
};

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
  relationships: OrganizationConfigRelationships,
): EnrichedOrganizationConfig {
  const enriched: EnrichedOrganizationConfig = { relationships };

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
    enriched[field] = toMetadataCodeLabel(value, labelLookup, CONFIG_FIELD_TO_METADATA_TYPE[field]);
  }

  for (const field of ENRICHABLE_CONFIG_ARRAY_FIELDS) {
    const values = config[field];
    if (!Array.isArray(values) || values.length === 0) continue;
    enriched[field] = values.map((code) =>
      toMetadataCodeLabel(code, labelLookup, CONFIG_FIELD_TO_METADATA_TYPE[field]),
    );
  }

  return enriched;
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

export async function deriveCountryStateGroups(
  config: OrganizationConfigData,
  labelLookup: MetadataLabelLookup,
  reader: OrgConfigMetadataReader,
  authHeader: string,
): Promise<CountryStateGroup[]> {
  const countryCodes = (config.enabledCountryCodes ?? []).map(normalizeCode).filter(Boolean);
  const enabledStates = new Set((config.enabledStateCodes ?? []).map(normalizeCode).filter(Boolean));

  if (countryCodes.length === 0 || enabledStates.size === 0) {
    return [];
  }

  const related = await reader.getRelatedValues(
    {
      fromType: 'Country',
      fromValues: countryCodes,
      relationType: 'PARENT_CHILD',
      toType: 'State',
    },
    authHeader,
  );

  const groups: CountryStateGroup[] = [];
  for (const group of related.groups ?? []) {
    const countryCode = normalizeCode(group.fromMetadataValueCode);
    if (!countryCodes.includes(countryCode)) continue;

    const states: MetadataCodeLabel[] = [];
    for (const relatedValue of group.values ?? []) {
      const stateCode = normalizeCode(relatedValue.metadataValueCode);
      if (!enabledStates.has(stateCode)) continue;
      states.push({
        code: stateCode,
        label:
          relatedValue.label?.trim() ||
          labelLookup.get('State')?.get(stateCode) ||
          stateCode,
      });
    }

    if (states.length === 0) continue;

    groups.push({
      country: {
        code: countryCode,
        label: group.fromLabel?.trim() || labelLookup.get('Country')?.get(countryCode) || countryCode,
      },
      states,
    });
  }

  groups.sort((left, right) => left.country.code.localeCompare(right.country.code));
  return groups;
}

export async function deriveStateCityGroups(
  config: OrganizationConfigData,
  labelLookup: MetadataLabelLookup,
  reader: OrgConfigMetadataReader,
  authHeader: string,
): Promise<StateCityGroup[]> {
  const stateCodes = (config.enabledStateCodes ?? []).map(normalizeCode).filter(Boolean);
  const enabledCities = new Set((config.enabledCityCodes ?? []).map(normalizeCode).filter(Boolean));

  if (stateCodes.length === 0 || enabledCities.size === 0) {
    return [];
  }

  const related = await reader.getRelatedValues(
    {
      fromType: 'State',
      fromValues: stateCodes,
      relationType: 'PARENT_CHILD',
      toType: 'City',
    },
    authHeader,
  );

  const groups: StateCityGroup[] = [];
  for (const group of related.groups ?? []) {
    const stateCode = normalizeCode(group.fromMetadataValueCode);
    if (!stateCodes.includes(stateCode)) continue;

    const cities: MetadataCodeLabel[] = [];
    for (const relatedValue of group.values ?? []) {
      const cityCode = normalizeCode(relatedValue.metadataValueCode);
      if (!enabledCities.has(cityCode)) continue;
      cities.push({
        code: cityCode,
        label:
          relatedValue.label?.trim() ||
          labelLookup.get('City')?.get(cityCode) ||
          cityCode,
      });
    }

    if (cities.length === 0) continue;

    groups.push({
      state: {
        code: stateCode,
        label: group.fromLabel?.trim() || labelLookup.get('State')?.get(stateCode) || stateCode,
      },
      cities,
    });
  }

  groups.sort((left, right) => left.state.code.localeCompare(right.state.code));
  return groups;
}

async function buildOrganizationConfigRelationships(
  config: OrganizationConfigData,
  labelLookup: MetadataLabelLookup,
  authHeader: string | undefined,
  reader: OrgConfigMetadataReader | undefined,
): Promise<OrganizationConfigRelationships> {
  if (!authHeader || !reader) {
    return { ...EMPTY_ORGANIZATION_CONFIG_RELATIONSHIPS };
  }

  const relationships: OrganizationConfigRelationships = {
    categoryConditionGroups: [],
    countryStateGroups: [],
    stateCityGroups: [],
  };

  try {
    relationships.categoryConditionGroups = await deriveCategoryConditionGroups(
      config,
      labelLookup,
      reader,
      authHeader,
    );
  } catch {
    // GET must not fail when relation lookup fails.
  }

  try {
    relationships.countryStateGroups = await deriveCountryStateGroups(
      config,
      labelLookup,
      reader,
      authHeader,
    );
  } catch {
    // GET must not fail when relation lookup fails.
  }

  try {
    relationships.stateCityGroups = await deriveStateCityGroups(config, labelLookup, reader, authHeader);
  } catch {
    // GET must not fail when relation lookup fails.
  }

  return relationships;
}

export async function enrichOrganizationConfig(
  config: OrganizationConfigData,
  options: {
    authHeader?: string;
    reader?: OrgConfigMetadataReader;
  } = {},
): Promise<{
  organizationConfig: EnrichedOrganizationConfig;
}> {
  let labelLookup: MetadataLabelLookup = new Map();
  const authHeader = options.authHeader?.trim();
  const reader = options.reader;

  if (authHeader && reader) {
    const metadataTypes = collectMetadataTypesForConfig(config);
    try {
      const registryResult = await reader.getValuesByTypes(metadataTypes, authHeader);
      labelLookup = buildMetadataLabelLookup(registryResult);
    } catch {
      labelLookup = new Map();
    }
  }

  const relationships = await buildOrganizationConfigRelationships(
    config,
    labelLookup,
    authHeader,
    reader,
  );
  const organizationConfig = enrichOrganizationConfigFields(config, labelLookup, relationships);

  return { organizationConfig };
}
