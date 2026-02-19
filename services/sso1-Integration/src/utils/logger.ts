/**
 * Structured JSON logger for AWS Lambda.
 *
 * Outputs log entries as newline-delimited JSON so that they are
 * automatically parsed by Amazon CloudWatch Logs Insights.
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  service: string;
  stage: string;
  requestId?: string;
  [key: string]: unknown;
}

class Logger {
  private readonly service: string;
  private readonly stage: string;
  private requestId?: string;

  constructor(service: string) {
    this.service = service;
    this.stage = process.env["STAGE"] ?? "dev";
  }

  /** Attach the Lambda request ID so every log line is traceable in CloudWatch. */
  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  private log(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.service,
      stage: this.stage,
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...meta,
    };

    // CloudWatch captures console.log/error
    if (level === "ERROR" || level === "WARN") {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("DEBUG", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("INFO", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("WARN", message, meta);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const errorMeta: Record<string, unknown> = { ...meta };

    if (error instanceof Error) {
      errorMeta["errorName"] = error.name;
      errorMeta["errorMessage"] = error.message;
      errorMeta["errorStack"] = error.stack;
    } else if (error !== undefined) {
      errorMeta["errorRaw"] = String(error);
    }

    this.log("ERROR", message, errorMeta);
  }
}

// ─── Singleton logger instances per handler module ────────────────────────────
export function createLogger(service: string): Logger {
  return new Logger(service);
}
