import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['dev', 'stg', 'prd', 'development', 'staging', 'production'])
    .default('dev'),
  SERVICE_NAME: z.string().default('sso-integration'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  COGNITO_SSO_COMMON_PASSWORD: z.string().min(1, 'COGNITO_SSO_COMMON_PASSWORD is required for user creation'),
  COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID is required'),
  COGNITO_CLIENT_ID: z.string().min(1, 'COGNITO_CLIENT_ID is required'),

  TRU_TECH_BASE_URL: z.string().url('TRU_TECH_BASE_URL must be a valid URL'),
  TRU_TECH_API_KEY: z.string().min(1, 'TRU_TECH_API_KEY is required'),
  TRU_TECH_TIMEOUT_MS: z.coerce.number().min(1000),

  // Schedule service configuration
  SCHEDULE_SERVICE_API_URL: z
    .string()
    .url('SCHEDULE_SERVICE_API_URL must be a valid URL')
    .default('https://schedule-service.example.com'),
  SCHEDULE_SERVICE_API_TIMEOUT_MS: z.coerce.number(),

  // Package/Service API configuration (for service-based schedule creation)
  PACKAGE_SERVICE_API_URL: z
    .string()
    .url('PACKAGE_SERVICE_API_URL must be a valid URL')
    .min(1, 'PACKAGE_SERVICE_API_URL is required'),
  PACKAGE_SERVICE_API_TIMEOUT_MS: z.coerce.number(),

  USER_SERVICE_BASE_URL: z
    .string()
    .url('USER_SERVICE_BASE_URL must be a valid URL'),

  // Static service token used for internal service-to-service communication
  // (e.g. SSO → Schedule Service, User Service). This should be provisioned
  // via the environment and treated as a secret.
  INTERNAL_SERVICE_TOKEN: z
    .string()
    .min(1, 'INTERNAL_SERVICE_TOKEN is required for internal communication'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().min(1).default(100),

  // Appointment sync configuration
  APPOINTMENT_SYNC_MAX_RETRIES: z.coerce.number().min(1).default(3),
  APPOINTMENT_SYNC_RETRY_DELAY_MS: z.coerce.number().min(100).default(1000),
  APPOINTMENT_SYNC_MAX_RETRY_DELAY_MS: z.coerce
    .number()
    .min(1000)
    .default(10000),
  APPOINTMENT_SYNC_CONCURRENCY_LIMIT: z.coerce.number().min(1).default(5),
  APPOINTMENT_SOURCE_TIMEZONE: z.string().min(1).default('Africa/Lusaka'),

  DOCTOR_ROLE_ID: z.string().min(1, 'DOCTOR_ROLE_ID is required'),

  PATIENT_ROLE_ID: z.string().min(1, 'PATIENT_ROLE_ID is required'),

  SUBDOMAIN: z.string().min(1, 'SUBDOMAIN is required'),
  PROVIDER: z.string().min(1, 'PROVIDER is required'),
  SSO_DEFAULT_ORGANIZATION_ID: z
    .string()
    .min(1, 'SSO_DEFAULT_ORGANIZATION_ID is required'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function loadEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Environment configuration validation failed: ${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function getEnvConfig(): EnvConfig {
  if (!cachedConfig) {
    return loadEnvConfig();
  }
  return cachedConfig;
}
