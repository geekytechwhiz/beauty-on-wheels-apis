import { contextMiddleware } from './context-middleware';
import { errorMiddleware } from './error.middleware';
import { loggerMiddleware } from './logger.middleware';
import { performanceMiddleware } from './performance.middleware';
import { schemaValidationMiddleware } from './schema-validation.middleware';
import { getTracerForService } from './tracer-singleton';
import { tracerMiddleware } from './tracer.middleware';
import type { Handler, Middleware, MiddlewarePipelineEvent } from './types';
import type { PayloadSchemaRegistry } from './event-schema/validate';
import { runMiddlewares } from './middlewareEngine';

/**
 * Standard Lambda HTTP / pipeline order (identical across services):
 * `error` → `context` → `logger` → `tracer` → `schema` → `performance` → handler
 */
export function createStandardLambdaHttpMiddlewares<
  TResult = unknown,
  TContext = unknown,
>(options: {
  /** X-Ray / Powertools service name (e.g. `user-service`). */
  serviceName: string;
  /** Operation name for performance metrics / logs (e.g. `user.get` or a route key). */
  operation: string;
  /** When omitted or empty, schema validation is a no-op for unknown `eventType` keys. */
  payloadSchemas?: PayloadSchemaRegistry;
}): Array<Middleware<MiddlewarePipelineEvent, TResult, TContext>> {
  const tracer = getTracerForService(options.serviceName);
  return [
    errorMiddleware(),
    contextMiddleware(),
    loggerMiddleware(),
    tracerMiddleware(tracer, { captureResponse: false }),
    schemaValidationMiddleware({ payloadSchemas: options.payloadSchemas ?? {} }),
    performanceMiddleware(options.operation),
  ];
}

type ApiGatewayishHandler<TEvent, TResult, TContext> = Handler<TEvent, TResult, TContext>;

/**
 * AWS Lambda `APIGatewayProxy` handler wrapper using {@link createStandardLambdaHttpMiddlewares}.
 */
export function withStandardApiGatewayPipeline<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  operation: string,
  businessHandler: ApiGatewayishHandler<TEvent, TResult, TContext>,
  options?: { serviceName?: string; payloadSchemas?: PayloadSchemaRegistry },
): (event: TEvent, context: TContext) => Promise<TResult> {
  return runMiddlewares(
    createStandardLambdaHttpMiddlewares<TResult, TContext>({
      serviceName:
        options?.serviceName ?? process.env.POWERTOOLS_SERVICE_NAME ?? 'apigateway',
      operation,
      payloadSchemas: options?.payloadSchemas,
    }) as Array<Middleware<TEvent, TResult, TContext>>,
    businessHandler,
  );
}
