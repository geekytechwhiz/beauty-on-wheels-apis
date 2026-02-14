/**
 * Central config for Domain API URLs and endpoints used by FHIR gateway adapters.
 * Values are read from environment variables (set in serverless.yml / .env) so
 * URLs stay out of the repo and can vary per stage (dev/stg/prod).
 *
 * To use a config file (e.g. config.json) for local overrides, load it here and
 * merge with process.env before returning.
 */

export interface UserServiceEndpointConfig {
  /** Base URL of the user/patient API (no trailing slash). */
  baseUrl: string;
  /**
   * Path template for "get patient by id".
   * Use {id} as placeholder, e.g. "get-user-details?userID={id}" or "/users/{id}".
   */
  patientPath: string;
}

export interface DeviceServiceEndpointConfig {
  /** Base URL of the device/observations API (no trailing slash). */
  baseUrl: string;
  /** Path for observations by patient (query param patientId). Default: "observations". */
  observationsPath: string;
}

/** All domain endpoints used by FHIR gateway adapters. */
export interface DomainEndpointsConfig {
  userService: UserServiceEndpointConfig;
  deviceService: DeviceServiceEndpointConfig;
}

const DEFAULT_USER_PATIENT_PATH = 'get-user-details?userID={id}';
const DEFAULT_OBSERVATIONS_PATH = 'observations';

function getEnv(key: string, fallback: string): string {
  const v = process.env[key];
  return (typeof v === 'string' && v.trim() !== '') ? v.trim() : fallback;
}

/**
 * Returns domain API URLs and endpoint paths for adapters.
 * Source: environment variables (USER_SERVICE_URL, DEVICE_SERVICE_URL, etc.).
 */
export function getDomainEndpoints(): DomainEndpointsConfig {
  return {
    userService: {
      baseUrl: getEnv('USER_SERVICE_URL', ''),
      patientPath: getEnv('USER_SERVICE_PATIENT_PATH', DEFAULT_USER_PATIENT_PATH),
    },
    deviceService: {
      baseUrl: getEnv('DEVICE_SERVICE_URL', ''),
      observationsPath: getEnv('DEVICE_SERVICE_OBSERVATIONS_PATH', DEFAULT_OBSERVATIONS_PATH),
    },
  };
}

/** User-service config only (for patient adapter). */
export function getUserServiceEndpoints(): UserServiceEndpointConfig {
  return getDomainEndpoints().userService;
}

/** Device-service config only (for observations). */
export function getDeviceServiceEndpoints(): DeviceServiceEndpointConfig {
  return getDomainEndpoints().deviceService;
}
