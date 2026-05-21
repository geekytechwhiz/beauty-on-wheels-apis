/**
 * Centralized middleware type definitions. No logging, cloud SDKs, or domain-specific logic.
 */

export type {
  LambdaInvocationContext,
} from '@api-hub/observability';

/** Minimal event shape; specialize per transport (e.g. APIGW, SQS, EventBridge). */
export type BaseEvent = Record<string, unknown>;

/**
 * Lambda / API-Gateway (or direct-invocation) event shape for {@link buildRequestContext}.
 * Narrower than {@link BaseEvent} so `headers` / `body` / path fields type-check.
 */
export interface RequestBuildEvent {
  /** HTTP or API Gateway headers (casing may vary by client). */
  headers?: Record<string, string | undefined> | null;
  body?: string | null | object;
  pathParameters?: Record<string, string | null> | null;
  queryStringParameters?: Record<string, string | null> | null;
  /** Unwrapped or direct payload (non-API-Gateway). */
  data?: unknown;
  userId?: string;
  userID?: string;
  organizationId?: string;
  organizationID?: string;
  [key: string]: unknown;
}

/**
 * Execution / Lambda or synthetic context. Use {@link ExecutionContext} when the pipeline
 * populates standard correlation fields. Unknown at the type level by default; specialize `TContext`.
 */
export type BaseContext = Record<string, unknown> | object;

/**
 * Parameters passed to each middleware. `next` continues the chain to the business handler.
 */
export interface MiddlewareParams<
  TEvent,
  TResult,
  TContext,
> {
  event: TEvent;
  context: TContext;
  next: () => Promise<TResult>;
}

/**
 * A single middleware: runs logic, then calls `next()` to proceed (or short-circuits with a return value).
 */
export type Middleware<TEvent, TResult, TContext> = (
  params: MiddlewareParams<TEvent, TResult, TContext>
) => Promise<TResult>;

/**
 * Final handler after all middleware.
 */
export type Handler<TEvent, TResult, TContext> = (
  event: TEvent,
  context: TContext
) => Promise<TResult>;

/**
 * Global lifecycle hooks (wrap the entire stack: middlewares + handler).
 */
export interface MiddlewareHooks<TEvent, TResult, TContext> {
  onBefore?: (event: TEvent, context: TContext) => void | Promise<void>;
  onAfter?: (
    result: TResult,
    event: TEvent,
    context: TContext
  ) => void | Promise<void>;
  onError?: (
    error: unknown,
    event: TEvent,
    context: TContext
  ) => void | Promise<void>;
}

/**
 * Optional hooks when composing {@link runMiddlewares}.
 */
export interface MiddlewareEngineOptions<TEvent, TResult, TContext> {
  hooks?: MiddlewareHooks<TEvent, TResult, TContext>;
}

/** Ordered list of middleware in execution order. */
export type MiddlewareGroup<TEvent, TResult, TContext> = Array<
  Middleware<TEvent, TResult, TContext>
>;

/**
 * Optional: typing helper for conditional middleware factories.
 * Implementations can wrap a `Middleware` and apply it only when `condition` is true.
 */
export type ConditionalMiddleware<TEvent, TResult, TContext> = (
  condition: (event: TEvent, context: TContext) => boolean,
  middleware: Middleware<TEvent, TResult, TContext>
) => Middleware<TEvent, TResult, TContext>;

/**
 * Optional structured error surface for higher layers; the engine only uses `unknown` in `onError`.
 */
export interface MiddlewareError extends Error {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface MiddlewareResult<TResult> {
  data?: TResult;
  error?: MiddlewareError;
}

/** Optional conventional context fields; prefer a dedicated `TContext` at call sites. */
/**
 * Cross-cutting request context (logging, tracing). Populated by upstream middleware and/or Lambda.
 * All fields are optional; consumers should guard when a field is required for their use case.
 */
export interface ExecutionContext {
  /** Client or platform correlation (may mirror header / message attribute). */
  correlationId?: string;
  /** AWS Lambda `context.awsRequestId` or equivalent. */
  awsRequestId?: string;
  /** AWS X-Ray / Lambda environment trace id (root segment id). */
  traceId?: string;
  /**
   * Handler / route operation name (e.g. `template.get`). Injected by
   * `invocationContextMiddleware` — not a domain event type.
   */
  operation?: string;
  /** EventBridge `source`, SQS `eventSource`, or logical producer (e.g. `aws:apigateway`). */
  source?: string;
  /** EventBridge `detail-type`, SQS channel hint, or `METHOD path` for HTTP. */
  eventType?: string;
  /** Authenticated subject id when available. */
  userId?: string;
  /** Tenant or organization scoping when available. */
  tenantId?: string;
  /** Whether realtime fan-out is enabled for this handler invocation. */
  realtimeEnabled?: boolean;
  [key: string]: unknown;
}

/**
 * `event` shape when prior middleware (e.g. context middleware) attaches `__context` aligned
 * with {@link ExecutionContext}.
 */
export type MiddlewarePipelineEvent = BaseEvent & {
  __context?: Partial<ExecutionContext> & Record<string, unknown>;
};
