// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED LOGGER
// Outputs JSON for CloudWatch Logs Insights queries
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  service: string;
  [key: string]: unknown;
}

class Logger {
  private service: string;
  private requestId?: string;

  constructor(service: string) {
    this.service = service;
  }

  /** Attach the Lambda request ID for correlation */
  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.service,
      ...(this.requestId && { requestId: this.requestId }),
      ...meta,
    };
    // Lambda stdout → CloudWatch Logs
    console.log(JSON.stringify(entry));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env["ENV"] !== "prod") {
      this.log("DEBUG", message, meta);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("INFO", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("WARN", message, meta);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const errorMeta =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : { errorRaw: error };
    this.log("ERROR", message, { ...errorMeta, ...meta });
  }
}

export const createLogger = (service: string): Logger => new Logger(service);
