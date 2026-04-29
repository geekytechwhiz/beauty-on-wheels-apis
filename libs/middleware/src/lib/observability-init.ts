import {
  initObservability,
  updateObservabilityConfig,
  type LogLevelName,
  type ObservabilityConfigInput,
} from '@api-hub/observability';

let initialized = false;

function parseLogLevel(value: string | undefined): LogLevelName | undefined {
  if (!value) return undefined;
  const u = value.toUpperCase();
  if (u === 'DEBUG' || u === 'INFO' || u === 'WARN' || u === 'ERROR') {
    return u;
  }
  return undefined;
}

function clampSample(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Idempotent bootstrap: maps process env to {@link initObservability}. Call from middleware / handlers
 * before `createLogger()` or metrics. The observability package itself does not read `process.env`.
 */
export function ensureObservabilityInitialized(overrides?: Partial<ObservabilityConfigInput>): void {
  if (initialized) {
    if (overrides && Object.keys(overrides).length > 0) {
      updateObservabilityConfig(overrides);
    }
    return;
  }

  const name = process.env.SERVICE_NAME?.trim();
  if (!name && (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production')) {
    throw new Error('SERVICE_NAME environment variable is required in Lambda and in production');
  }

  initObservability({
    serviceName: name || 'local-dev-service',
    logLevel: parseLogLevel(process.env.LOG_LEVEL) ?? 'INFO',
    metricsNamespace: process.env.POWERTOOLS_METRICS_NAMESPACE,
    sampling: {
      info: clampSample(process.env.OBSERVABILITY_SAMPLE_INFO, 1),
      debug: clampSample(process.env.OBSERVABILITY_SAMPLE_DEBUG, 0),
    },
    ...overrides,
  });
  initialized = true;
}
