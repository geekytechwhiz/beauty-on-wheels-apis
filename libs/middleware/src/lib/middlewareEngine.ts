// middlewareEngine.ts

/**
 * Generic Middleware Type
 */
export type Middleware<TEvent = any, TResult = any, TContext = any> = (params: {
    event: TEvent;
    context: TContext;
    next: () => Promise<TResult>;
  }) => Promise<TResult>;
  
  /**
   * Middleware Hooks (Enterprise Extension)
   */
  export interface MiddlewareHooks<TEvent = any, TResult = any, TContext = any> {
    onBefore?: (event: TEvent, context: TContext) => Promise<void> | void;
    onAfter?: (
      result: TResult,
      event: TEvent,
      context: TContext
    ) => Promise<void> | void;
    onError?: (
      error: unknown,
      event: TEvent,
      context: TContext
    ) => Promise<void> | void;
  }
  
  /**
   * Engine Options
   */
  export interface MiddlewareEngineOptions<
    TEvent = any,
    TResult = any,
    TContext = any
  > {
    hooks?: MiddlewareHooks<TEvent, TResult, TContext>;
  }
  
  /**
   * Core Middleware Runner
   */
  export const runMiddlewares = <
    TEvent = any,
    TResult = any,
    TContext = any
  >(
    middlewares: Middleware<TEvent, TResult, TContext>[],
    handler: (event: TEvent, context: TContext) => Promise<TResult>,
    options?: MiddlewareEngineOptions<TEvent, TResult, TContext>
  ) => {
    return async (event: TEvent, context: TContext): Promise<TResult> => {
      let index = -1;
  
      const { hooks } = options || {};
  
      /**
       * Runner function (recursive chain)
       */
      const dispatch = async (): Promise<TResult> => {
        index++;
  
        // Execute middleware
        if (index < middlewares.length) {
          const middleware = middlewares[index];
  
          return middleware({
            event,
            context,
            next: dispatch,
          });
        }
  
        // Final handler
        return handler(event, context);
      };
  
      try {
        // BEFORE HOOK
        if (hooks?.onBefore) {
          await hooks.onBefore(event, context);
        }
  
        const result = await dispatch();
  
        // AFTER HOOK
        if (hooks?.onAfter) {
          await hooks.onAfter(result, event, context);
        }
  
        return result;
      } catch (error) {
        // ERROR HOOK
        if (hooks?.onError) {
          await hooks.onError(error, event, context);
        }
  
        throw error;
      }
    };
  };