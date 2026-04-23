// packages/platform/src/pipeline.ts

import { Middleware } from "./types";

export const createPipeline = (
  middlewares: Middleware[],
  handler: (event: any, context: any) => Promise<any>
) => {
  return async (event: any, context: any) => {
    let index = -1;

    const runner = async (i: number): Promise<any> => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const mw = middlewares[i];

      if (!mw) {
        return handler(event, context);
      }

      return mw(event, context, () => runner(i + 1));
    };

    return runner(0);
  };
};