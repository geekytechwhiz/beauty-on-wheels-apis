export interface LogEntry {
  event?: string;
  message?: string;
  err?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Override service name for this logger instance (defaults to config). */
  serviceName?: string;
  /** Override Powertools log level label if needed (usually unused — filtering is library-side). */
  persistLogLevel?: string;
  [key: string]: unknown;
}
