export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ObservabilityConfigInput {
  serviceName: string;
  logLevel?: LogLevelName;
  sampling?: { info?: number; debug?: number };
  redactPII?: boolean;
  enforceLogPolicy?: boolean;
  metricsNamespace?: string;
  /** When true and a log violates policy, emit a single-line warning to stderr. */
  logPolicyViolationsToStderr?: boolean;
}

export interface ObservabilityConfig {
  readonly serviceName: string;
  readonly logLevel: LogLevelName;
  /** Minimum numeric level required to emit (emit when entry level >= this). */
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

function normalizeLogLevel(value: string | undefined): LogLevelName {
  const u = (value ?? 'INFO').toUpperCase();
  if (u === 'DEBUG' || u === 'WARN' || u === 'ERROR' || u === 'INFO') {
    return u;
  }
  return 'INFO';
}

function resolveConfig(input: ObservabilityConfigInput): ObservabilityConfig {
  const logLevel = normalizeLogLevel(input.logLevel);
  const sampling = input.sampling ?? {};
  return {
    serviceName: input.serviceName,
    logLevel,
    logLevelFloor: LEVEL_TO_FLOOR[logLevel],
    sampling: {
      info: clamp01(sampling.info ?? 1),
      debug: clamp01(sampling.debug ?? 0),
    },
    redactPII: input.redactPII ?? true,
    enforceLogPolicy: input.enforceLogPolicy ?? true,
    metricsNamespace: input.metricsNamespace ?? 'ApiHub',
    logPolicyViolationsToStderr: input.logPolicyViolationsToStderr ?? false,
  };
}

let lastInput: ObservabilityConfigInput | undefined;
let resolved: ObservabilityConfig | undefined;

export function initObservability(input: ObservabilityConfigInput): void {
  lastInput = input;
  resolved = resolveConfig(input);
}

export function getConfig(): ObservabilityConfig {
  if (!resolved) {
    throw new Error(
      '@api-hub/observability: not initialized — call initObservability() before createLogger() or metrics APIs'
    );
  }
  return resolved;
}

export function updateObservabilityConfig(partial: Partial<ObservabilityConfigInput>): void {
  if (!lastInput) {
    throw new Error('@api-hub/observability: updateObservabilityConfig requires prior initObservability()');
  }
  const mergedSampling = {
    ...lastInput.sampling,
    ...partial.sampling,
  };
  lastInput = { ...lastInput, ...partial, sampling: mergedSampling };
  resolved = resolveConfig(lastInput);
}

export function assertInitialized(): void {
  getConfig();
}
