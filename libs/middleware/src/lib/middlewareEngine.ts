import type {
  Handler,
  Middleware,
  MiddlewareEngineOptions,
} from './types';

/**
 * Composes middleware and a final handler. Each middleware calls `next()` to continue the chain.
 * Optional global `hooks` run outside the per-link chain (before all / after success / on failure).
 */
export function runMiddlewares<TEvent, TResult, TContext = unknown>(
  middlewares: Middleware<TEvent, TResult, TContext>[],
  handler: Handler<TEvent, TResult, TContext>,
  options?: MiddlewareEngineOptions<TEvent, TResult, TContext>
): (event: TEvent, context: TContext) => Promise<TResult> {
  return async (event: TEvent, context: TContext): Promise<TResult> => {
    const { hooks } = options ?? {};
    let index = -1;

    const dispatch = async (): Promise<TResult> => {
      index += 1;

      if (index < middlewares.length) {
        const middleware = middlewares[index];
        return middleware({
          event,
          context,
          next: dispatch,
        });
      }

      return handler(event, context);
    };

    try {
      if (hooks?.onBefore) {
        await hooks.onBefore(event, context);
      }

      const result = await dispatch();

      if (hooks?.onAfter) {
        await hooks.onAfter(result, event, context);
      }

      return result;
    } catch (error) {
      if (hooks?.onError) {
        await hooks.onError(error, event, context);
      }

      throw error;
    }
  };
}
