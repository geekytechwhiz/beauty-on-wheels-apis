// middlewareEngine.ts

export type Middleware<TEvent = any, TResult = any> = (params: {
    event: TEvent;
    context: any;
    next: () => Promise<TResult>;
  }) => Promise<TResult>;
  
  export const runMiddlewares = async <TEvent, TResult>(
    middlewares: Middleware<TEvent, TResult>[],
    handler: (event: TEvent, context: any) => Promise<TResult>
  ) => {
    return async (event: TEvent, context: any): Promise<TResult> => {
      let index = -1;
  
      const runner = async (): Promise<TResult> => {
        index++;
  
        if (index < middlewares.length) {
          return middlewares[index]({
            event,
            context,
            next: runner,
          });
        }
  
        return handler(event, context);
      };
  
      return runner();
    };
  };