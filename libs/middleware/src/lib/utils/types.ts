// types.ts

/**
 * Base Event Type
 * Extend this in your domain (API Gateway, EventBridge, etc.)
 */
export type BaseEvent = Record<string, unknown>;

/**
 * Base Context Type
 * Can represent AWS Lambda context or custom execution context
 */
export type BaseContext = Record<string, unknown>;

/**
 * Middleware Function Type
 */
export type Middleware<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> = (params: MiddlewareParams<TEvent, TResult, TContext>) => Promise<TResult>;

/**
 * Middleware Parameters
 */
export interface MiddlewareParams<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> {
  event: TEvent;
  context: TContext;
  next: () => Promise<TResult>;
}

/**
 * Handler Type (Final business logic)
 */
export type Handler<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> = (event: TEvent, context: TContext) => Promise<TResult>;

/**
 * Middleware Lifecycle Hooks
 */
export interface MiddlewareHooks<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> {
  /**
   * Runs before any middleware executes
   */
  onBefore?: (
    event: TEvent,
    context: TContext
  ) => Promise<void> | void;

  /**
   * Runs after successful execution
   */
  onAfter?: (
    result: TResult,
    event: TEvent,
    context: TContext
  ) => Promise<void> | void;

  /**
   * Runs when an error occurs
   */
  onError?: (
    error: unknown,
    event: TEvent,
    context: TContext
  ) => Promise<void> | void;
}

/**
 * Middleware Engine Options
 */
export interface MiddlewareEngineOptions<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> {
  hooks?: MiddlewareHooks<TEvent, TResult, TContext>;
}

/**
 * Middleware Composition Utility Type
 */
export type MiddlewareGroup<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> = Middleware<TEvent, TResult, TContext>[];

/**
 * Conditional Middleware Wrapper
 */
export type ConditionalMiddleware<
  TEvent = BaseEvent,
  TResult = unknown,
  TContext = BaseContext
> = (
  condition: (event: TEvent, context: TContext) => boolean,
  middleware: Middleware<TEvent, TResult, TContext>
) => Middleware<TEvent, TResult, TContext>;

/**
 * Error Shape (Standardized)
 */
export interface MiddlewareError extends Error {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

/**
 * Async Middleware Result Wrapper (for advanced use cases)
 */
export interface MiddlewareResult<TResult = unknown> {
  data?: TResult;
  error?: MiddlewareError;
}

/**
 * Extended Context (Optional Enhancement)
 * Useful if you want to enforce structured context across services
 */
export interface ExecutionContext extends BaseContext {
  correlationId?: string;
  awsRequestId?: string;
  userId?: string;
  tenantId?: string;
  [key: string]: unknown;
}