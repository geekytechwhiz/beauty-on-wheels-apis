/**
 * Ambient typings for `@api-hub/logger` so this package type-checks when the workspace
 * does not expose the dependency via node_modules (pnpm layout) or path mapping would
 * pull sibling sources outside `rootDir`. Runtime still uses the real package from
 * `dependencies`.
 */
declare module '@api-hub/logger' {
  export interface LogEntry {
    event?: string;
    message?: string;
    err?: unknown;
    [key: string]: unknown;
  }

  export class Logger {
    error(entry: LogEntry): void;
    warn(entry: LogEntry): void;
    info(entry: LogEntry): void;
    http(entry: LogEntry): void;
    verbose(entry: LogEntry): void;
    debug(entry: LogEntry): void;
  }

  export interface LoggerOptions {
    service?: string;
    redactPII?: boolean;
    [key: string]: unknown;
  }

  export function createLogger(options?: LoggerOptions): Logger;
}
