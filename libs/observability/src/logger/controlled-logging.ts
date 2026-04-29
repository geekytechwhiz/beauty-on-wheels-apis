type LoggerLike = {
  info: (
    a: string | Record<string, unknown>,
    b?: Record<string, unknown>
  ) => void;
  warn: (
    a: string | Record<string, unknown>,
    b?: Record<string, unknown>
  ) => void;
  error: (
    a: string | Record<string, unknown>,
    b?: Record<string, unknown>
  ) => void;
};

export interface HttpLogData {
  method: string;
  path: string;
  statusCode: number;
  durationMs?: number;
  /** @deprecated Use durationMs. */
  duration?: number;
  correlationId?: string;
  awsRequestId?: string;
  event?: string;
  [key: string]: unknown;
}

export function logHttpRequest(logger: LoggerLike, data: HttpLogData): void {
  const durationMs =
    typeof data.durationMs === 'number'
      ? data.durationMs
      : typeof data.duration === 'number'
        ? data.duration
        : 0;
  const metadata: Record<string, unknown> = {
    event: data.event ?? 'http_request',
    message: 'HTTP request completed',
    correlationId: data.correlationId,
    awsRequestId: data.awsRequestId,
    durationMs,
    http: {
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
    },
  };

  if (data.statusCode >= 500) {
    logger.error(metadata);
    return;
  }

  if (data.statusCode >= 400) {
    logger.warn(metadata);
    return;
  }

  logger.info(metadata);
}

export interface DbQueryLogData {
  operation: string;
  /** Table / collection / entity hint — not raw SQL text. */
  resource?: string;
  durationMs: number;
  /** e.g. 'select' | 'insert' (optional). */
  kind?: string;
  correlationId?: string;
  awsRequestId?: string;
  rowCount?: number;
  event?: string;
  [key: string]: unknown;
}

export function logDbQuery(logger: LoggerLike, data: DbQueryLogData): void {
  const metadata: Record<string, unknown> = {
    event: data.event ?? 'db_query',
    message: 'Database operation completed',
    db: {
      operation: data.operation,
      resource: data.resource,
      kind: data.kind,
      durationMs: data.durationMs,
      ...(data.rowCount !== undefined ? { rowCount: data.rowCount } : {}),
    },
    correlationId: data.correlationId,
    awsRequestId: data.awsRequestId,
  };

  if (data.durationMs > 30_000) {
    logger.warn({ ...metadata, message: 'Slow database operation' });
    return;
  }

  logger.info(metadata);
}

export interface ExternalCallLogData {
  /** Human-readable target, e.g. `partner-api` — not full URL with secrets. */
  target: string;
  operation: string;
  durationMs: number;
  statusCode?: number;
  outcome?: 'success' | 'failure' | 'timeout';
  correlationId?: string;
  awsRequestId?: string;
  event?: string;
  err?: unknown;
  [key: string]: unknown;
}

export function logExternalCall(logger: LoggerLike, data: ExternalCallLogData): void {
  const metadata: Record<string, unknown> = {
    event: data.event ?? 'external_call',
    message: 'Outbound dependency call completed',
    external: {
      target: data.target,
      operation: data.operation,
      durationMs: data.durationMs,
      ...(data.statusCode !== undefined ? { statusCode: data.statusCode } : {}),
      ...(data.outcome ? { outcome: data.outcome } : {}),
    },
    correlationId: data.correlationId,
    awsRequestId: data.awsRequestId,
  };

  if (data.err !== undefined) {
    metadata.err = data.err;
  }

  if (data.outcome === 'failure' || data.outcome === 'timeout' || (data.statusCode ?? 0) >= 500) {
    logger.error(metadata);
    return;
  }

  if ((data.statusCode ?? 0) >= 400) {
    logger.warn(metadata);
    return;
  }

  logger.info(metadata);
}
