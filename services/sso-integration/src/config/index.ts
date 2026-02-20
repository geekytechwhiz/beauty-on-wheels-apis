/**
 * Configuration Module
 * 
 * Centralized configuration with environment variable validation.
 * Fails fast at startup if required config is missing or invalid.
 */

import { logger } from '../utils/logger';

export interface AppConfig {
  jwtSecret: string;
  sessionExpiry: number;
  appIssuer: string;
  appBaseUrl: string;
  apiBaseUrl: string;
  hmsClientsTable: string;
  useInMemoryStorage: boolean;
  redirectUriAllowlist: string[];
  isProduction: boolean;
  /** Cognito User Pool ID for SSO (find/create user, AdminInitiateAuth) */
  cognitoUserPoolId: string;
  /** Cognito App Client ID (confidential client for AdminInitiateAuth) */
  cognitoClientId: string;
  /** Cognito App Client Secret (required for ADMIN_USER_PASSWORD_AUTH) */
  cognitoClientSecret: string;
  /** AWS region for Cognito */
  cognitoRegion: string;
  /** Secret used to derive SSO password for Cognito (deterministic per doctor_uid) */
  cognitoSsoPasswordSecret: string;
  /** user-service base URL for GET/POST internal users (e.g. https://xxx.execute-api.us-east-1.amazonaws.com/dev) */
  userServiceBaseUrl: string;
  /** Optional API key for internal user-service calls */
  userServiceInternalApiKey: string;
}

/**
 * Validates that a required environment variable is set
 */
function requireEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value || value === 'change-in-production' || value === '') {
    const message = `Required environment variable ${name} is not set or has invalid default value`;
    logger.error(message);
    throw new Error(message);
  }
  return value;
}

/**
 * Validates that a required environment variable is set (allows empty string if explicitly set)
 */
function requireEnvOrEmpty(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    const message = `Required environment variable ${name} is not set`;
    logger.error(message);
    throw new Error(message);
  }
  return value;
}

/**
 * Gets an optional environment variable with a default
 */
function getEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Gets a number from environment variable with validation
 */
function getEnvNumber(name: string, defaultValue: number, min?: number, max?: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    logger.warn(`Invalid number for ${name}, using default: ${defaultValue}`);
    return defaultValue;
  }
  
  if (min !== undefined && num < min) {
    logger.warn(`${name} (${num}) is below minimum (${min}), using minimum`);
    return min;
  }
  
  if (max !== undefined && num > max) {
    logger.warn(`${name} (${num}) is above maximum (${max}), using maximum`);
    return max;
  }
  
  return num;
}

/**
 * Gets a boolean from environment variable
 */
function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Gets an array from comma-separated environment variable
 */
function getEnvArray(name: string, defaultValue: string[] = []): string[] {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

/**
 * Loads and validates application configuration
 */
export function loadConfig(): AppConfig {
  const stage = process.env.STAGE || process.env.SERVERLESS_STAGE || 'dev';
  const isProduction = stage === 'prod' || stage === 'production';
  const isOffline = process.env.IS_OFFLINE === 'true';

  // JWT_SECRET is critical - must not be default in production
  const jwtSecret = isProduction
    ? requireEnv('JWT_SECRET')
    : requireEnv('JWT_SECRET', 'change-in-production'); // Allow default in dev, but warn

  if (jwtSecret === 'change-in-production' && isProduction) {
    throw new Error('JWT_SECRET must be set to a secure value in production');
  }

  // HMS_CLIENTS_TABLE is required unless using in-memory storage
  const useInMemoryStorage = isOffline || getEnvBoolean('USE_IN_MEMORY_STORAGE', false);
  const hmsClientsTable = useInMemoryStorage
    ? ''
    : requireEnv('HMS_CLIENTS_TABLE');

  const cognitoUserPoolId = getEnv('COGNITO_USER_POOL_ID', 'us-east-1_AK1HTxdlX');
  const cognitoClientId = getEnv('COGNITO_CLIENT_ID', '');
  const cognitoClientSecret = getEnv('COGNITO_CLIENT_SECRET', '');
  const cognitoRegion = getEnv('AWS_REGION', getEnv('COGNITO_REGION', 'us-east-1'));
  const cognitoSsoPasswordSecret = getEnv('COGNITO_SSO_PASSWORD_SECRET', '');
  const userServiceBaseUrl = getEnv('USER_SERVICE_BASE_URL', '');
  const userServiceInternalApiKey = getEnv('USER_SERVICE_INTERNAL_API_KEY', '');

  const config: AppConfig = {
    jwtSecret,
    sessionExpiry: getEnvNumber('SESSION_EXPIRY', 3600, 60, 86400), // 1 min to 24 hours
    appIssuer: getEnv('APP_ISSUER', 'myvitalrx-sso'),
    appBaseUrl: requireEnv('APP_BASE_URL', 'https://app.myvitalrx.com'),
    apiBaseUrl: requireEnvOrEmpty('API_BASE_URL', ''),
    hmsClientsTable,
    useInMemoryStorage,
    redirectUriAllowlist: getEnvArray('REDIRECT_URI_ALLOWLIST', []),
    isProduction,
    cognitoUserPoolId,
    cognitoClientId,
    cognitoClientSecret,
    cognitoRegion,
    cognitoSsoPasswordSecret,
    userServiceBaseUrl,
    userServiceInternalApiKey,
  };

  // Log config (without secrets) for debugging
  logger.info('Configuration loaded', {
    stage,
    isProduction,
    useInMemoryStorage,
    sessionExpiry: config.sessionExpiry,
    appIssuer: config.appIssuer,
    appBaseUrl: config.appBaseUrl,
    hasApiBaseUrl: !!config.apiBaseUrl,
    hasHmsClientsTable: !!config.hmsClientsTable,
    redirectUriAllowlistCount: config.redirectUriAllowlist.length,
    hasCognito: !!(config.cognitoUserPoolId && config.cognitoClientId && config.cognitoClientSecret && config.cognitoSsoPasswordSecret),
    hasUserService: !!config.userServiceBaseUrl,
  });

  return config;
}

// Singleton config instance (loaded once at module import)
let configInstance: AppConfig | null = null;

/**
 * Gets the application configuration (singleton)
 * Loads config on first access
 */
export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Resets the config singleton (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
