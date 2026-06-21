import type { OrganizationConfigData, OrganizationConfigPatch } from '../models';
import { ORGANIZATION_CONFIG_DATA_KEYS } from '../models/Organization';

const normalizeCode = (value: string): string => value.trim().toUpperCase();

const uniqueCodes = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalizeCode).filter((code) => code.length > 0)));

/** Normalizes and deduplicates enabled metadata codes for persistence. */
export function normalizeEnabledCodes(codes: string[]): string[] {
  return uniqueCodes(codes);
}

/** @deprecated Use {@link normalizeEnabledCodes}. */
export function normalizeEnabledCountryCodes(codes: string[]): string[] {
  return normalizeEnabledCodes(codes);
}

/** Legacy single-value location fields on persisted CONFIG items (pre–multi-location). */
export interface LegacyLocationConfigFields {
  countryCode?: string;
  stateCode?: string;
  cityCode?: string;
}

/**
 * Extracts module codes from legacy `modules` payloads (object map or string array).
 */
export function extractModuleCodes(modules: unknown): string[] {
  if (Array.isArray(modules)) {
    return uniqueCodes(
      modules.filter((item): item is string => typeof item === 'string'),
    );
  }
  if (modules && typeof modules === 'object') {
    const codes: string[] = [];
    for (const [key, value] of Object.entries(modules as Record<string, unknown>)) {
      if (value === true || value === 'true' || value === 1) {
        codes.push(key);
      }
    }
    return uniqueCodes(codes);
  }
  return [];
}

/**
 * Extracts device codes from legacy `devices` payloads (object map or string array).
 */
export function extractDeviceCodes(devices: unknown): string[] {
  if (Array.isArray(devices)) {
    return uniqueCodes(
      devices.filter((item): item is string => typeof item === 'string'),
    );
  }
  if (devices && typeof devices === 'object') {
    const codes: string[] = [];
    for (const [key, value] of Object.entries(devices as Record<string, unknown>)) {
      if (value === true || value === 'true' || value === 1) {
        codes.push(key);
      }
    }
    return uniqueCodes(codes);
  }
  return [];
}

/**
 * Maps legacy frontend `organizationConfig` (+ optional top-level modules/devices)
 * to the new `OrganizationConfigData` shape used by the draft config API.
 */
export function mapLegacyOrganizationConfigToNew(
  legacy: OrganizationConfigPatch,
  context?: { modules?: unknown; devices?: unknown },
): OrganizationConfigData {
  const mapped: OrganizationConfigData = {};

  if (legacy.supportedCountries?.length) {
    mapped.enabledCountryCodes = uniqueCodes(legacy.supportedCountries);
  }
  if (legacy.supportedStates?.length) {
    mapped.enabledStateCodes = uniqueCodes(legacy.supportedStates);
  }
  if (legacy.supportedLanguages?.length) {
    mapped.defaultLanguageCode = normalizeCode(legacy.supportedLanguages[0]);
    mapped.supportedLanguageCodes = uniqueCodes(legacy.supportedLanguages);
  }
  if (legacy.supportedCategories?.length) {
    mapped.enabledCategoryCodes = uniqueCodes(legacy.supportedCategories);
  }
  if (legacy.supportedConditions?.length) {
    mapped.enabledConditionCodes = uniqueCodes(legacy.supportedConditions);
  }

  const moduleCodes = extractModuleCodes(context?.modules);
  if (moduleCodes.length) {
    mapped.enabledModuleCodes = moduleCodes;
  }
  const deviceCodes = extractDeviceCodes(context?.devices);
  if (deviceCodes.length) {
    mapped.enabledDeviceCodes = deviceCodes;
  }

  return mapped;
}

/**
 * Merges a legacy config patch with the latest stored legacy arrays (partial-update semantics).
 */
export function mergeLegacyOrganizationConfigPatch(
  patch: OrganizationConfigPatch,
  latest: OrganizationConfigPatch | null,
): Required<OrganizationConfigPatch> {
  return {
    supportedCountries: patch.supportedCountries ?? latest?.supportedCountries ?? [],
    supportedLanguages: patch.supportedLanguages ?? latest?.supportedLanguages ?? [],
    supportedStates: patch.supportedStates ?? latest?.supportedStates ?? [],
    supportedCategories: patch.supportedCategories ?? latest?.supportedCategories ?? [],
    supportedConditions: patch.supportedConditions ?? latest?.supportedConditions ?? [],
  };
}

/**
 * Merges mapped new-model fields over the latest config version (partial-update semantics).
 */
function hasPresentConfigFieldValue(
  value: OrganizationConfigData[keyof OrganizationConfigData] | undefined,
): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * Merges legacy + new-model config for GET reads. New-model values win when present;
 * legacy values fill gaps. Empty arrays on the stored item do not block legacy fallback.
 */
export function mergeStoredOrganizationConfigForRead(
  fromNew: OrganizationConfigData,
  fromLegacy: OrganizationConfigData,
): OrganizationConfigData {
  const merged: OrganizationConfigData = {};

  for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
    const newValue = fromNew[key];
    const legacyValue = fromLegacy[key];

    if (hasPresentConfigFieldValue(newValue)) {
      (merged as Record<string, unknown>)[key] = newValue;
    } else if (hasPresentConfigFieldValue(legacyValue)) {
      (merged as Record<string, unknown>)[key] = legacyValue;
    } else if (newValue !== undefined) {
      (merged as Record<string, unknown>)[key] = newValue;
    } else if (legacyValue !== undefined) {
      (merged as Record<string, unknown>)[key] = legacyValue;
    }
  }

  return merged;
}

export function mergeOrganizationConfigData(
  patch: OrganizationConfigData,
  latest: OrganizationConfigData | null,
): OrganizationConfigData {
  const merged: OrganizationConfigData = {};

  for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
    const patchValue = patch[key];
    const latestValue = latest?.[key];
    if (patchValue !== undefined) {
      (merged as Record<string, unknown>)[key] = patchValue;
    } else if (latestValue !== undefined) {
      (merged as Record<string, unknown>)[key] = latestValue;
    }
  }
  return merged;
}

/** Projects persisted config fields from a CONFIG item or partial patch. */
export function toOrganizationConfigData(
  source: OrganizationConfigData | null | undefined,
): OrganizationConfigData {
  if (!source) return {};
  const data: OrganizationConfigData = {};
  for (const key of ORGANIZATION_CONFIG_DATA_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      (data as Record<string, unknown>)[key] = value;
    }
  }
  return data;
}

/**
 * Ensures enabled location arrays are populated from legacy single-value / supported* sources.
 */
export function reconcileEnabledLocationCodes(
  config: OrganizationConfigData,
  legacy?: LegacyLocationConfigFields,
): OrganizationConfigData {
  const reconciled: OrganizationConfigData = { ...config };

  if (!reconciled.enabledCountryCodes?.length) {
    if (legacy?.countryCode) {
      reconciled.enabledCountryCodes = [normalizeCode(legacy.countryCode)];
    }
  } else {
    reconciled.enabledCountryCodes = uniqueCodes(reconciled.enabledCountryCodes);
  }

  if (!reconciled.enabledStateCodes?.length) {
    if (legacy?.stateCode) {
      reconciled.enabledStateCodes = [normalizeCode(legacy.stateCode)];
    }
  } else {
    reconciled.enabledStateCodes = uniqueCodes(reconciled.enabledStateCodes);
  }

  if (!reconciled.enabledCityCodes?.length) {
    if (legacy?.cityCode) {
      reconciled.enabledCityCodes = [normalizeCode(legacy.cityCode)];
    }
  } else {
    reconciled.enabledCityCodes = uniqueCodes(reconciled.enabledCityCodes);
  }

  return reconciled;
}

/** @deprecated Use {@link reconcileEnabledLocationCodes}. */
export function reconcileEnabledCountryCodes(config: OrganizationConfigData): OrganizationConfigData {
  return reconcileEnabledLocationCodes(config);
}

/**
 * Maps a persisted CONFIG item to `OrganizationConfigData` for read APIs.
 * New-model fields win; legacy `supported*` arrays fill gaps for older versions.
 */
export function mapStoredOrganizationConfigToData(
  item: OrganizationConfigData & OrganizationConfigPatch & LegacyLocationConfigFields,
): OrganizationConfigData {
  const fromNew = toOrganizationConfigData(item);
  const fromLegacy = mapLegacyOrganizationConfigToNew({
    supportedCountries: item.supportedCountries,
    supportedLanguages: item.supportedLanguages,
    supportedStates: item.supportedStates,
    supportedCategories: item.supportedCategories,
    supportedConditions: item.supportedConditions,
  });
  return reconcileEnabledLocationCodes(mergeStoredOrganizationConfigForRead(fromNew, fromLegacy), {
    countryCode: item.countryCode,
    stateCode: item.stateCode,
    cityCode: item.cityCode,
  });
}

export function hasOrganizationConfigData(config: OrganizationConfigData): boolean {
  return ORGANIZATION_CONFIG_DATA_KEYS.some((key) => config[key] !== undefined);
}
