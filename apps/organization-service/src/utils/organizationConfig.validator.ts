import type {
  MetadataRelatedValuesResultDto,
  MetadataValuesByTypesResultDto,
} from '@api-hub/service-clients';
import type { OrganizationConfigData } from '../models';
import { ORGANIZATION_CONFIG_DATA_KEYS } from '../models/Organization';
import { CONFIG_FIELD_TO_METADATA_TYPE } from './organizationConfig.metadata-types';
import {
  InvalidMetadataRelationError,
  InvalidMetadataValueError,
} from './errors';

export interface OrgConfigMetadataReader {
  getValuesByTypes(metadataTypeCodes: string[], authHeader: string): Promise<MetadataValuesByTypesResultDto>;
  getRelatedValues(
    params: {
      fromType: string;
      fromValues: string[];
      relationType?: string;
      toType?: string;
    },
    authHeader: string,
  ): Promise<MetadataRelatedValuesResultDto>;
}

export interface OrgConfigValidationContext {
  conditionsByCategory: Map<string, Set<string>>;
}

const normalizeCode = (value: string): string => value.trim().toUpperCase();

const collectCodesForField = (config: OrganizationConfigData, field: keyof OrganizationConfigData): string[] => {
  const value = config[field];
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeCode).filter((code) => code.length > 0);
  }
  const code = normalizeCode(String(value));
  return code.length > 0 ? [code] : [];
};

const relatedValueCodes = (result: MetadataRelatedValuesResultDto): Set<string> =>
  new Set(
    result.groups.flatMap((group) =>
      group.values.map((value) => normalizeCode(value.metadataValueCode)),
    ),
  );

const relatedValuesBySource = (result: MetadataRelatedValuesResultDto): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const group of result.groups) {
    const source = normalizeCode(group.fromMetadataValueCode);
    const existing = map.get(source) ?? new Set<string>();
    for (const value of group.values) {
      existing.add(normalizeCode(value.metadataValueCode));
    }
    map.set(source, existing);
  }
  return map;
};

export function computeChangedConfigSections(
  next: OrganizationConfigData,
  previous: OrganizationConfigData | null,
): string[] {
  const changed: string[] = [];
  for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
    const nextValue = next[key];
    const previousValue = previous?.[key];
    if (Array.isArray(nextValue) || Array.isArray(previousValue)) {
      const left = Array.isArray(nextValue) ? nextValue.map(normalizeCode) : [];
      const right = Array.isArray(previousValue) ? previousValue.map(normalizeCode) : [];
      if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
        changed.push(key);
      }
    } else if ((nextValue ?? undefined) !== (previousValue ?? undefined)) {
      changed.push(key);
    }
  }
  return changed;
}

function throwMetadataValue(message: string): never {
  throw new InvalidMetadataValueError(message);
}

function throwMetadataRelation(message: string): never {
  throw new InvalidMetadataRelationError(message);
}

export async function validateOrganizationConfigForPublish(
  config: OrganizationConfigData,
  reader: OrgConfigMetadataReader,
  authHeader: string,
): Promise<OrgConfigValidationContext> {
  const metadataTypes = new Set<string>();
  const codesByType = new Map<string, Map<string, keyof OrganizationConfigData>>();

  for (const [field, metadataType] of Object.entries(CONFIG_FIELD_TO_METADATA_TYPE) as Array<
    [keyof OrganizationConfigData, string]
  >) {
    const codes = collectCodesForField(config, field);
    if (codes.length === 0) continue;
    metadataTypes.add(metadataType);
    const typeMap = codesByType.get(metadataType) ?? new Map<string, keyof OrganizationConfigData>();
    for (const code of codes) {
      typeMap.set(code, field);
    }
    codesByType.set(metadataType, typeMap);
  }

  if (metadataTypes.size > 0) {
    const registryResult = await reader.getValuesByTypes([...metadataTypes], authHeader);
    for (const missingType of registryResult.missingMetadataTypeCodes ?? []) {
      throwMetadataValue(`Metadata type ${missingType} is not registered`);
    }

    const activeCodesByType = new Map<string, Set<string>>();
    for (const item of registryResult.items ?? []) {
      activeCodesByType.set(
        item.metadataType,
        new Set(
          item.values
            .filter((value) => String(value.status).toLowerCase() === 'active')
            .map((value) => normalizeCode(value.valueCode)),
        ),
      );
    }

    for (const [metadataType, fieldCodes] of codesByType.entries()) {
      const activeCodes = activeCodesByType.get(metadataType) ?? new Set<string>();
      for (const [code] of fieldCodes.entries()) {
        if (!activeCodes.has(code)) {
          throwMetadataValue(`${metadataType} ${code} does not exist`);
        }
      }
    }
  }

  if (config.enabledCountryCodes?.length && config.enabledStateCodes?.length) {
    const countryCodes = collectCodesForField(config, 'enabledCountryCodes');
    const countryState = await reader.getRelatedValues(
      {
        fromType: 'Country',
        fromValues: countryCodes,
        relationType: 'PARENT_CHILD',
        toType: 'State',
      },
      authHeader,
    );
    const statesByCountry = relatedValuesBySource(countryState);
    for (const stateCode of collectCodesForField(config, 'enabledStateCodes')) {
      const validForCountry = countryCodes.some((countryCode) =>
        statesByCountry.get(countryCode)?.has(stateCode),
      );
      if (!validForCountry) {
        throwMetadataRelation(
          `State ${stateCode} is not valid for any enabled Country (${countryCodes.join(', ')})`,
        );
      }
    }
  }

  if (config.enabledStateCodes?.length && config.enabledCityCodes?.length) {
    const stateCodes = collectCodesForField(config, 'enabledStateCodes');
    const stateCity = await reader.getRelatedValues(
      {
        fromType: 'State',
        fromValues: stateCodes,
        relationType: 'PARENT_CHILD',
        toType: 'City',
      },
      authHeader,
    );
    const citiesByState = relatedValuesBySource(stateCity);
    for (const cityCode of collectCodesForField(config, 'enabledCityCodes')) {
      const validForState = stateCodes.some((stateCode) => citiesByState.get(stateCode)?.has(cityCode));
      if (!validForState) {
        throwMetadataRelation(
          `City ${cityCode} is not valid for any enabled State (${stateCodes.join(', ')})`,
        );
      }
    }
  }

  if (config.currencyCode) {
    const countriesForCurrency = collectCodesForField(config, 'enabledCountryCodes');
    if (countriesForCurrency.length > 0) {
      const currencyCountry = await reader.getRelatedValues(
        {
          fromType: 'Currency',
          fromValues: [normalizeCode(config.currencyCode)],
          relationType: 'VALID_IN',
          toType: 'Country',
        },
        authHeader,
      );
      const validCountries = relatedValueCodes(currencyCountry);
      const currencyCode = normalizeCode(config.currencyCode);
      const matchesCountry = countriesForCurrency.some((country) => validCountries.has(country));
      if (!matchesCountry) {
        throwMetadataRelation(
          `Currency ${currencyCode} is not valid for any enabled Country (${countriesForCurrency.join(', ')})`,
        );
      }
    }
  }

  const enabledCategories = collectCodesForField(config, 'enabledCategoryCodes');
  const enabledConditions = collectCodesForField(config, 'enabledConditionCodes');
  let conditionsByCategory = new Map<string, Set<string>>();

  if (enabledCategories.length > 0 && enabledConditions.length > 0) {
    const categoryConditions = await reader.getRelatedValues(
      {
        fromType: 'Category',
        fromValues: enabledCategories,
        relationType: 'BELONGS_TO_CATEGORY',
        toType: 'Condition',
      },
      authHeader,
    );
    conditionsByCategory = relatedValuesBySource(categoryConditions);

    for (const conditionCode of enabledConditions) {
      const owningCategories = enabledCategories.filter((categoryCode) =>
        conditionsByCategory.get(normalizeCode(categoryCode))?.has(conditionCode),
      );
      if (owningCategories.length === 0) {
        throwMetadataRelation(
          `Condition ${conditionCode} does not belong to any enabled Category`,
        );
      }
    }
  }

  const enabledDevices = collectCodesForField(config, 'enabledDeviceCodes');
  const enabledVitals = collectCodesForField(config, 'enabledVitalCodes');
  if (enabledDevices.length > 0 && enabledVitals.length > 0) {
    const deviceVitals = await reader.getRelatedValues(
      {
        fromType: 'Device',
        fromValues: enabledDevices,
        relationType: 'SUPPORTED_BY',
        toType: 'Vital',
      },
      authHeader,
    );
    const vitalsByDevice = relatedValuesBySource(deviceVitals);
    for (const vitalCode of enabledVitals) {
      const supported = enabledDevices.some((deviceCode) =>
        vitalsByDevice.get(normalizeCode(deviceCode))?.has(vitalCode),
      );
      if (!supported) {
        throwMetadataRelation(`Vital ${vitalCode} is not supported by any enabled Device`);
      }
    }
  }

  const enabledMetrics = collectCodesForField(config, 'enabledMetricCodes');
  if (enabledVitals.length > 0 && enabledMetrics.length > 0) {
    const vitalMetrics = await reader.getRelatedValues(
      {
        fromType: 'Vital',
        fromValues: enabledVitals,
        toType: 'MetricCode',
      },
      authHeader,
    );
    const hasCataloguedRelations = vitalMetrics.groups.some((group) => group.values.length > 0);
    if (hasCataloguedRelations) {
      const metricsByVital = relatedValuesBySource(vitalMetrics);
      for (const metricCode of enabledMetrics) {
        const linked = enabledVitals.some((vitalCode) =>
          metricsByVital.get(normalizeCode(vitalCode))?.has(metricCode),
        );
        if (!linked) {
          throwMetadataRelation(`MetricCode ${metricCode} is not linked to any enabled Vital`);
        }
      }
    }
  }

  return { conditionsByCategory };
}
