import type { OrganizationConfigData, OrganizationConfigPatch } from '../models';
import { ORGANIZATION_CONFIG_DATA_KEYS } from '../models/Organization';

const normalizeCode = (value: string): string => value.trim().toUpperCase();

const uniqueCodes = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalizeCode).filter((code) => code.length > 0)));

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
    mapped.countryCode = normalizeCode(legacy.supportedCountries[0]);
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
