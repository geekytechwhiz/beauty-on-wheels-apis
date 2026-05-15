import type { Handler, Middleware, MiddlewarePipelineEvent } from '@api-hub/middleware';
import { buildEventExecutionPipeline, runMiddlewares } from '@api-hub/middleware';

export type OperationName =
  `${string}.${'created' | 'updated' | 'deleted' | 'processed' | 'failed'}`;

export function composeEventHandlerWithMiddleware<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(options: {
  operation: OperationName;
  handler: Handler<TEvent, TResult, TContext>;
}): (event: TEvent, context: TContext) => Promise<TResult> {
  const stack = buildEventExecutionPipeline<TResult, TContext>({
    operation: options.operation,
  }) as Array<Middleware<TEvent, TResult, TContext>>;

  return runMiddlewares(stack, options.handler);
}
