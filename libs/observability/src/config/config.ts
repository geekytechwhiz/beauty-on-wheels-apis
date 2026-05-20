export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ObservabilityConfigInput {
  serviceName?: string; // 🔁 now optional
  logLevel?: LogLevelName;
  sampling?: { info?: number; debug?: number };
  redactPII?: boolean;
  enforceLogPolicy?: boolean;
  metricsNamespace?: string;
  logPolicyViolationsToStderr?: boolean;
}

export interface ObservabilityConfig {
  readonly serviceName: string;
  readonly logLevel: LogLevelName;
  readonly logLevelFloor: number;
  readonly sampling: { readonly info: number; readonly debug: number };
  readonly redactPII: boolean;
  readonly enforceLogPolicy: boolean;
  readonly metricsNamespace: string;
  readonly logPolicyViolationsToStderr: boolean;
}

const LEVEL_TO_FLOOR: Record<LogLevelName, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function clamp01(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeLogLevel(value?: string): LogLevelName {
  const u = (value ?? '').toUpperCase();
  if (u === 'DEBUG' || u === 'WARN' || u === 'ERROR' || u === 'INFO') {
    return u;
  }
  return 'ERROR'; // 🔥 safer default
}

/**
 * 🔥 Default config from ENV (auto-init)
 */
function getDefaultInput(): ObservabilityConfigInput {
  return {
    serviceName: process.env.SERVICE_NAME ?? 'unknown-service',
    logLevel: normalizeLogLevel(process.env.LOG_LEVEL),
    sampling: {
      info: Number(process.env.LOG_SAMPLE_INFO ?? 1),
      debug: Number(process.env.LOG_SAMPLE_DEBUG ?? 0.01),
    },
    redactPII: process.env.REDACT_PII !== 'false',
    enforceLogPolicy: true,
    metricsNamespace: process.env.METRICS_NAMESPACE ?? 'ApiHub',
    logPolicyViolationsToStderr:
      process.env.LOG_POLICY_STDERR === 'true',
  };
}

function resolveConfig(input: ObservabilityConfigInput): ObservabilityConfig {
  const logLevel = normalizeLogLevel(input.logLevel);

  const sampling = input.sampling ?? {};

  return {
    serviceName: input.serviceName ?? 'unknown-service',
    logLevel,
    logLevelFloor: LEVEL_TO_FLOOR[logLevel],
    sampling: {
      info: clamp01(sampling.info ?? 1),
      debug: clamp01(sampling.debug ?? 0.01),
    },
    redactPII: input.redactPII ?? true,
    enforceLogPolicy: input.enforceLogPolicy ?? true,
    metricsNamespace: input.metricsNamespace ?? 'ApiHub',
    logPolicyViolationsToStderr:
      input.logPolicyViolationsToStderr ?? false,
  };
}

let overrideInput: Partial<ObservabilityConfigInput> = {};
let resolved: ObservabilityConfig | null = null;

/**
 * ✅ Optional override (NOT required)
 */
export function configureObservability(
  input: Partial<ObservabilityConfigInput>
): void {
  overrideInput = {
    ...overrideInput,
    ...input,
  };

  resolved = null; // 🔁 force recompute
}

/**
 * ✅ Auto-init config
 */
export function getConfig(): ObservabilityConfig {
  if (!resolved) {
    const base = getDefaultInput();

    const merged: ObservabilityConfigInput = {
      ...base,
      ...overrideInput,
      sampling: {
        ...base.sampling,
        ...overrideInput.sampling,
      },
    };

    resolved = resolveConfig(merged);
  }

  return resolved;
}