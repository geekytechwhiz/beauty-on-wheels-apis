import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['dev', 'stg', 'prd', 'development', 'staging', 'production']).default('dev'),
  SERVICE_NAME: z.string().default('sso-integration'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID is required'),
  COGNITO_CLIENT_ID: z.string().min(1, 'COGNITO_CLIENT_ID is required'),

  TRU_TECH_BASE_URL: z.string().url('TRU_TECH_BASE_URL must be a valid URL'),
  TRU_TECH_API_KEY: z.string().min(1, 'TRU_TECH_API_KEY is required'),
  TRU_TECH_TIMEOUT_MS: z.coerce.number().min(1000).max(30000).default(5000),

  USER_SERVICE_BASE_URL: z.string().url('USER_SERVICE_BASE_URL must be a valid URL'),
  USER_SERVICE_INTERNAL_API_KEY: z.string().min(1, 'USER_SERVICE_INTERNAL_API_KEY is required'),

  ROLE_SERVICE_BASE_URL: z.string().url('ROLE_SERVICE_BASE_URL must be a valid URL'),
  ROLE_SERVICE_INTERNAL_API_KEY: z.string().min(1, 'ROLE_SERVICE_INTERNAL_API_KEY is required'),

  // Secret used to sign and verify internal service-level JWTs issued by the
  // SSO integration service (not Cognito tokens).
  SERVICE_TOKEN_SECRET: z.string().min(1, 'SERVICE_TOKEN_SECRET is required'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().min(1).default(100),
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

export function isProduction(): boolean {
  const env = getEnvConfig().NODE_ENV;
  return env === 'prd' || env === 'production';
}

export function isDevelopment(): boolean {
  const env = getEnvConfig().NODE_ENV;
  return env === 'dev' || env === 'development';
}
